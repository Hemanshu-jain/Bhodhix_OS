const crypto = require('crypto');
const fs = require('fs');
const nodemailer = require('nodemailer');

const PIN_DIGITS = 6;
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 60 * 1000;
const SESSION_MS = 12 * 60 * 60 * 1000;
const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const ASSIGNABLE_ROLES = ['admin', 'member', 'viewer'];

function loadPin(pinFile) {
  if (process.env.BHODIX_PIN) return process.env.BHODIX_PIN.trim();
  if (fs.existsSync(pinFile)) {
    const existing = fs.readFileSync(pinFile, 'utf8').trim();
    if (existing) return existing;
  }
  const pin = String(crypto.randomInt(0, 10 ** PIN_DIGITS)).padStart(PIN_DIGITS, '0');
  fs.writeFileSync(pinFile, `${pin}\n`, { mode: 0o600 });
  return pin;
}

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const safeEqual = (a, b) => crypto.timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const emailOf = (value) => String(value || '').trim().toLowerCase();
const publicUser = ({ passwordSalt, passwordHash, ...user }) => user;
const validEmail = (email) => /^\S+@\S+\.\S+$/.test(email) && email.length <= 254;
const slugOf = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

function createAuth(pin, storeFile, { emailVerificationRequired = false, publicBaseUrl = 'http://127.0.0.1:4000', smtpUrl = '', emailFrom = '', defaultWorkspaceName = 'Bhodhix Workspace' } = {}) {
  let store = { organizations: [], users: [], memberships: [], sessions: [], invites: [], emailTokens: [] };
  if (fs.existsSync(storeFile)) {
    store = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    store.organizations ||= []; store.users ||= []; store.memberships ||= []; store.sessions ||= []; store.invites ||= [];
    store.emailTokens ||= [];
    store.users.forEach((user) => { if (user.emailVerified === undefined) user.emailVerified = true; });
  }
  const mailer = smtpUrl ? nodemailer.createTransport(smtpUrl) : null;
  const failures = new Map();
  const signupFailures = new Map();
  const emailAttempts = new Map();
  const recentFailures = (map, key, now) => (map.get(key) || []).filter((time) => now - time < LOGIN_WINDOW_MS);
  const emailRequestAllowed = (key) => {
    const now = Date.now();
    const attempts = (emailAttempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
    if (attempts.length >= 3) return false;
    emailAttempts.set(key, [...attempts, now]);
    return true;
  };
  const save = () => {
    fs.mkdirSync(require('path').dirname(storeFile), { recursive: true });
    fs.writeFileSync(storeFile, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  };
  const fail = (res, status, error) => res.status(status).json({ success: false, error });
  const userByEmail = (email) => store.users.find((user) => user.email === emailOf(email) && user.active);
  const orgBySlug = (slug) => store.organizations.find((org) => org.slug === slugOf(slug) && org.active !== false);
  const passwordRecord = (password) => {
    const salt = crypto.randomBytes(16).toString('hex');
    return { passwordSalt: salt, passwordHash: crypto.scryptSync(password, salt, 64).toString('hex') };
  };
  const passwordMatches = (password, user) => safeEqual(crypto.scryptSync(password, user.passwordSalt, 64).toString('hex'), user.passwordHash);
  const membershipFor = (userId, organizationId) => store.memberships.find((item) => item.userId === userId && item.organizationId === organizationId && item.active);
  const sessionFor = (token) => store.sessions.find((session) => safeEqual(session.tokenHash, hash(token)) && session.expiresAt > Date.now());
  const createSession = (user, membership, organization) => {
    const token = crypto.randomBytes(32).toString('hex');
    store.sessions = store.sessions.filter((session) => session.expiresAt > Date.now());
    store.sessions.push({ tokenHash: hash(token), userId: user.id, membershipId: membership.id, organizationId: organization.id, expiresAt: Date.now() + SESSION_MS });
    save();
    return { token, user: { ...publicUser(user), role: membership.role, organization: { id: organization.id, name: organization.name, slug: organization.slug } } };
  };
  const createUser = (name, email, password) => ({ id: crypto.randomUUID(), name: name.trim(), email, active: true, emailVerified: !emailVerificationRequired, createdAt: new Date().toISOString(), ...passwordRecord(password) });
  const createOrganization = (name, id = crypto.randomUUID()) => {
    const base = slugOf(name);
    let slug = base || id.slice(0, 8);
    while (store.organizations.some((org) => org.slug === slug)) slug = `${(base || 'workspace').slice(0, 40)}-${crypto.randomBytes(3).toString('hex')}`;
    const organization = { id, name: name.trim(), slug, active: true, createdAt: new Date().toISOString() };
    store.organizations.push(organization);
    return organization;
  };
  const addMembership = (userId, organizationId, role) => {
    const membership = { id: crypto.randomUUID(), userId, organizationId, role, active: true, createdAt: new Date().toISOString() };
    store.memberships.push(membership);
    return membership;
  };

  const newEmailToken = (user, purpose) => {
    const token = crypto.randomBytes(32).toString('base64url');
    const ttl = purpose === 'verify' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
    store.emailTokens = store.emailTokens.filter((item) => item.userId !== user.id || item.purpose !== purpose);
    store.emailTokens.push({ userId: user.id, purpose, tokenHash: hash(token), expiresAt: Date.now() + ttl });
    save();
    return token;
  };
  const sendAccountEmail = async (user, purpose) => {
    if (!mailer || !emailFrom) throw new Error('Email delivery is not configured. Contact your workspace administrator.');
    const token = newEmailToken(user, purpose);
    const url = new URL(purpose === 'verify' ? '/api/auth/verify-email' : '/api/auth/reset-password', publicBaseUrl);
    url.searchParams.set('token', token);
    const verification = purpose === 'verify';
    await mailer.sendMail({
      from: emailFrom,
      to: user.email,
      subject: verification ? 'Verify your Bhodhix email' : 'Reset your Bhodhix password',
      text: `${verification ? 'Verify your email' : 'Reset your password'} using this link (it expires in ${verification ? '24 hours' : '1 hour'}): ${url.href}`,
      html: `<p>${verification ? 'Verify your email address' : 'Reset your Bhodhix password'} by opening the link below. It expires in ${verification ? '24 hours' : '1 hour'}.</p><p><a href="${url.href}">${verification ? 'Verify email' : 'Reset password'}</a></p>`
    });
  };

  function authenticateMcpUser(workspace, email, password) {
    const key = `mcp:${slugOf(workspace)}:${emailOf(email)}`;
    const now = Date.now();
    const attempts = recentFailures(failures, key, now);
    if (attempts.length >= LOGIN_LIMIT) throw new Error('Too many sign-in attempts. Wait a minute and retry.');
    const user = userByEmail(email);
    const organization = orgBySlug(workspace);
    const membership = user && organization && membershipFor(user.id, organization.id);
    if (!user || !user.emailVerified || !organization || !membership || typeof password !== 'string' || !passwordMatches(password, user)) {
      failures.set(key, [...attempts, now]);
      throw new Error('Workspace, email, or password is incorrect.');
    }
    failures.delete(key);
    return { user: publicUser(user), membership, organization };
  }

  function getMcpIdentity(userId, membershipId, organizationId) {
    const user = store.users.find((item) => item.id === userId && item.active && item.emailVerified);
    const membership = store.memberships.find((item) => item.id === membershipId && item.userId === userId && item.organizationId === organizationId && item.active);
    const organization = store.organizations.find((item) => item.id === organizationId && item.active !== false);
    return user && membership && organization
      ? { user: { ...publicUser(user), role: membership.role }, membership, organization }
      : null;
  }

  function setupStatus(req, res) {
    const organization = store.organizations.find((org) => org.id === 'bhodhix' && org.active !== false);
    return res.json({ success: true, setupComplete: !!organization && store.memberships.some((item) => item.organizationId === organization.id && item.role === 'owner' && item.active), legacyWorkspaceName: organization?.name || '' });
  }

  async function setupOwner(req, res) {
    const existing = store.organizations.find((org) => org.id === 'bhodhix' && org.active !== false);
    if (existing && store.memberships.some((item) => item.organizationId === existing.id && item.role === 'owner' && item.active)) return fail(res, 409, 'Workspace owner is already set up');
    const now = Date.now();
    const attempts = recentFailures(failures, 'setup', now);
    if (attempts.length >= LOGIN_LIMIT) return fail(res, 429, 'Too many attempts. Wait a minute and retry.');
    const { pin: suppliedPin, name, email, password } = req.body || {};
    if (typeof suppliedPin !== 'string' || !safeEqual(suppliedPin.trim(), pin)) { failures.set('setup', [...attempts, now]); return fail(res, 401, 'Incorrect setup PIN'); }
    const normalizedEmail = emailOf(email);
    const company = String(existing?.name || defaultWorkspaceName || 'Bhodhix Workspace').trim().slice(0, 120);
    if (!String(name || '').trim() || String(name).trim().length > 120 || !validEmail(normalizedEmail)) return fail(res, 400, 'Enter your name and a valid email');
    if (typeof password !== 'string' || password.length < 12 || password.length > 256) return fail(res, 400, 'Password must be 12 to 256 characters');
    if (userByEmail(normalizedEmail)) return fail(res, 409, 'Email is already registered');
    const organization = existing || createOrganization(company, 'bhodhix');
    const user = createUser(name, normalizedEmail, password);
    store.users.push(user);
    const membership = addMembership(user.id, organization.id, 'owner');
    failures.delete('setup');
    if (emailVerificationRequired) {
      try { await sendAccountEmail(user, 'verify'); }
      catch { return fail(res, 503, 'The owner account was created, but the verification email could not be sent. Use Resend verification email or contact support.'); }
      return res.json({ success: true, verificationRequired: true, email: user.email });
    }
    return res.json({ success: true, ...createSession(user, membership, organization) });
  }

  async function signup(req, res) {
    const email = emailOf(req.body?.email);
    const name = String(req.body?.name || '').trim();
    const organizationName = String(req.body?.organizationName || '').trim();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const address = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const now = Date.now();
    const attempts = recentFailures(signupFailures, address, now);
    if (attempts.length >= 10) return fail(res, 429, 'Too many workspace signups. Try again later.');
    if (!name || name.length > 120 || !organizationName || organizationName.length > 120 || !validEmail(email)) return fail(res, 400, 'Enter your name, company name, and valid email');
    if (password.length < 12 || password.length > 256) return fail(res, 400, 'Password must be 12 to 256 characters');
    if (userByEmail(email)) { signupFailures.set(address, [...attempts, now]); return fail(res, 409, 'Email is already registered'); }
    const organization = createOrganization(organizationName);
    const user = createUser(name, email, password);
    store.users.push(user);
    const membership = addMembership(user.id, organization.id, 'owner');
    signupFailures.delete(address);
    if (emailVerificationRequired) {
      try { await sendAccountEmail(user, 'verify'); }
      catch { return fail(res, 503, 'Your workspace was created, but the verification email could not be sent. Use Resend verification email or contact support.'); }
      return res.json({ success: true, verificationRequired: true, email: user.email });
    }
    return res.json({ success: true, ...createSession(user, membership, organization) });
  }

  function login(req, res) {
    const now = Date.now();
    const email = emailOf(req.body?.email);
    const slug = slugOf(req.body?.workspace);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length > 256) return fail(res, 400, 'Password must be no more than 256 characters');
    const attempts = recentFailures(failures, email, now);
    if (attempts.length >= LOGIN_LIMIT) return fail(res, 429, 'Too many attempts. Wait a minute and retry.');
    const user = userByEmail(email);
    const memberships = user ? store.memberships.filter((item) => item.userId === user.id && item.active && store.organizations.some((org) => org.id === item.organizationId && org.active !== false)) : [];
    const selected = slug ? memberships.find((item) => store.organizations.find((org) => org.id === item.organizationId)?.slug === slug) : memberships.length === 1 ? memberships[0] : null;
    if (!user || !memberships.length || !passwordMatches(password, user)) {
      failures.set(email, [...attempts, now]);
      return fail(res, 401, 'Incorrect email or password');
    }
    failures.delete(email);
    if (!user.emailVerified) return fail(res, 403, 'Verify your email before signing in. Use “Resend verification email” to get a new link.');
    if (!selected) {
      const workspaces = memberships.map((membership) => {
        const organization = store.organizations.find((org) => org.id === membership.organizationId);
        return organization && { name: organization.name, slug: organization.slug };
      }).filter(Boolean);
      return res.json({ success: true, requiresWorkspace: true, workspaces });
    }
    const organization = store.organizations.find((org) => org.id === selected.organizationId);
    return res.json({ success: true, ...createSession(user, selected, organization) });
  }

  function requireAuth(req, res, next) {
    const supplied = req.get('x-bhodix-token') || req.query.token || '';
    const session = sessionFor(supplied);
    const user = session && store.users.find((item) => item.id === session.userId && item.active);
    const membership = session && store.memberships.find((item) => item.id === session.membershipId && item.userId === session.userId && item.organizationId === session.organizationId && item.active);
    const organization = session && store.organizations.find((item) => item.id === session.organizationId && item.active !== false);
    if (!user || !user.emailVerified || !membership || !organization) return fail(res, 401, 'Session expired. Please sign in again.');
    req.user = { ...publicUser(user), role: membership.role, projectIds: membership.projectIds ?? null };
    req.membership = membership;
    req.organization = organization;
    req.sessionToken = supplied;
    return next();
  }

  const sessionValid = (token) => {
    const session = sessionFor(token);
    return !!session && !!store.users.find((user) => user.id === session.userId && user.active && user.emailVerified)
      && !!store.memberships.find((membership) => membership.id === session.membershipId && membership.userId === session.userId && membership.organizationId === session.organizationId && membership.active)
      && !!store.organizations.find((org) => org.id === session.organizationId && org.active !== false);
  };
  const requireRole = (...roles) => (req, res, next) => roles.includes(req.user?.role) ? next() : fail(res, 403, 'Your account does not have permission for this action');

  function logout(req, res) {
    const supplied = req.get('x-bhodix-token') || '';
    store.sessions = store.sessions.filter((session) => !safeEqual(session.tokenHash, hash(supplied)));
    save();
    return res.json({ success: true });
  }

  function listTeam(req, res) {
    const members = store.memberships.filter((item) => item.organizationId === req.organization.id && item.active).map((membership) => {
      const user = store.users.find((item) => item.id === membership.userId && item.active);
      return user ? { id: membership.id, userId: user.id, name: user.name, email: user.email, role: membership.role, workMode: membership.workMode || 'office', projectIds: membership.projectIds ?? null, createdAt: membership.createdAt } : null;
    }).filter(Boolean);
    return res.json({ success: true, currentUser: req.user, organization: req.organization, members });
  }

  function isActiveMember(userId, organizationId) {
    return store.memberships.some((item) => item.userId === userId && item.organizationId === organizationId && item.active);
  }

  function memberCanAccessProject(userId, organizationId, projectId) {
    const membership = store.memberships.find((item) => item.userId === userId && item.organizationId === organizationId && item.active);
    return !!membership && (!Array.isArray(membership.projectIds) || membership.projectIds.includes(projectId));
  }

  function memberWorkMode(userId, organizationId) {
    return store.memberships.find((item) => item.userId === userId && item.organizationId === organizationId && item.active)?.workMode || 'office';
  }

  function administratorIds(organizationId) {
    return store.memberships.filter((item) => item.organizationId === organizationId && item.active && ['owner', 'admin'].includes(item.role)).map((item) => item.userId);
  }

  function memberName(userId) { return store.users.find((item) => item.id === userId)?.name || 'A team member'; }

  function updateWorkMode(req, res) {
    const membership = store.memberships.find((item) => item.id === req.params.id && item.organizationId === req.organization.id && item.active);
    const workMode = req.body?.workMode;
    if (!membership || !['field', 'office', 'hybrid'].includes(workMode)) return fail(res, 400, 'Select field, office, or hybrid work');
    membership.workMode = workMode;
    save();
    return res.json({ success: true, workMode });
  }

  function notificationRecipients(organizationId, assignee = '') {
    const target = String(assignee || '').trim().toLowerCase();
    return store.memberships.filter((membership) => membership.organizationId === organizationId && membership.active).flatMap((membership) => {
      const user = store.users.find((item) => item.id === membership.userId && item.active && item.emailVerified);
      return user && (!target || user.name.toLowerCase() === target || user.email.toLowerCase() === target) ? [user.id] : [];
    });
  }

  async function createInvite(req, res) {
    const role = ['member', 'viewer'].includes(req.body?.role) ? req.body.role : 'member';
    const email = emailOf(req.body?.email);
    if (email && !validEmail(email)) return fail(res, 400, 'Enter a valid email');
    if (email && mailer && emailFrom && !emailRequestAllowed(`invite:${email}`)) return fail(res, 429, 'Too many invitations for this email. Wait 15 minutes and retry.');
    const user = email && userByEmail(email);
    if (user && membershipFor(user.id, req.organization.id)) return fail(res, 409, 'That email is already on the team');
    const code = crypto.randomBytes(24).toString('base64url');
    store.invites = store.invites.filter((invite) => !invite.usedAt && invite.expiresAt > Date.now());
    store.invites.push({ id: crypto.randomUUID(), organizationId: req.organization.id, codeHash: hash(code), email, role, createdBy: req.user.id, createdAt: new Date().toISOString(), expiresAt: Date.now() + INVITE_MS });
    save();
    const inviteUrl = new URL('/', publicBaseUrl);
    inviteUrl.searchParams.set('invite', code);
    let emailSent = false;
    if (email && mailer && emailFrom) {
      try {
        await mailer.sendMail({
          from: emailFrom,
          to: email,
          subject: 'You are invited to Bhodhix',
          text: `You have been invited to join a Bhodhix workspace as a ${role}. Open this link to accept: ${inviteUrl.href}`,
          html: `<p>You have been invited to join a Bhodhix workspace as a ${role}.</p><p><a href="${inviteUrl.href}">Accept invitation</a></p><p>This single-use link expires in seven days.</p>`
        });
        emailSent = true;
      } catch { /* Keep the generated invite usable as a manually shared link. */ }
    }
    return res.json({ success: true, code, role, email, emailSent, expiresAt: Date.now() + INVITE_MS });
  }

  async function join(req, res) {
    const code = String(req.body?.code || '');
    const invite = store.invites.find((item) => safeEqual(item.codeHash, hash(code)) && !item.usedAt && item.expiresAt > Date.now());
    if (!invite) return fail(res, 400, 'Invite is invalid or expired');
    const email = emailOf(req.body?.email);
    const name = String(req.body?.name || '').trim();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!validEmail(email) || !name || name.length > 120) return fail(res, 400, 'Enter your name and valid email');
    if (invite.email && invite.email !== email) return fail(res, 403, 'This invite was sent to a different email');
    if (password.length < 12 || password.length > 256) return fail(res, 400, 'Password must be 12 to 256 characters');
    let user = userByEmail(email);
    if (user) {
      if (!passwordMatches(password, user)) return fail(res, 401, 'An account already uses this email. Enter its password to join.');
    } else {
      user = createUser(name, email, password);
      store.users.push(user);
    }
    if (membershipFor(user.id, invite.organizationId)) return fail(res, 409, 'You are already a member of this workspace');
    const organization = store.organizations.find((item) => item.id === invite.organizationId && item.active !== false);
    if (!organization) return fail(res, 400, 'This workspace is no longer available');
    const membership = addMembership(user.id, organization.id, invite.role);
    invite.usedAt = new Date().toISOString();
    if (emailVerificationRequired && !user.emailVerified) {
      try { await sendAccountEmail(user, 'verify'); }
      catch { return fail(res, 503, 'Your account was added, but the verification email could not be sent. Use Resend verification email or contact support.'); }
      return res.json({ success: true, verificationRequired: true, email: user.email });
    }
    return res.json({ success: true, ...createSession(user, membership, organization) });
  }

  async function resendVerification(req, res) {
    const email = emailOf(req.body?.email);
    if (!validEmail(email)) return fail(res, 400, 'Enter a valid email');
    if (!emailRequestAllowed(`verify:${email}`)) return fail(res, 429, 'Too many email requests. Wait 15 minutes and retry.');
    const user = userByEmail(email);
    if (user && !user.emailVerified) {
      try { await sendAccountEmail(user, 'verify'); } catch { /* Avoid revealing account or mail status. */ }
    }
    return res.json({ success: true, message: 'If this account needs verification, a new link has been sent.' });
  }

  async function requestPasswordReset(req, res) {
    const email = emailOf(req.body?.email);
    if (!validEmail(email)) return fail(res, 400, 'Enter a valid email');
    if (!mailer || !emailFrom) return fail(res, 503, 'Password reset email is not configured. Contact your workspace administrator.');
    if (!emailRequestAllowed(`reset:${email}`)) return fail(res, 429, 'Too many email requests. Wait 15 minutes and retry.');
    const user = userByEmail(email);
    if (user?.emailVerified) {
      try { await sendAccountEmail(user, 'reset'); } catch { /* Keep the response identical for unknown and known accounts. */ }
    }
    return res.json({ success: true, message: 'If a verified account uses that email, a password reset link has been sent.' });
  }

  const tokenRecord = (token, purpose) => store.emailTokens.find((item) => item.purpose === purpose && item.expiresAt > Date.now() && safeEqual(item.tokenHash, hash(token || '')));
  const accountPage = (title, message) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title} · Bhodhix</title></head><body style="font:16px system-ui;background:#0b0d14;color:#eef0fa;max-width:520px;margin:12vh auto;padding:24px"><h1>${title}</h1><p>${message}</p><p><a style="color:#a5b4fc" href="${publicBaseUrl}/">Return to Bhodhix</a></p></body></html>`;

  function showEmailVerification(req, res) {
    const record = tokenRecord(req.query?.token, 'verify');
    const user = record && store.users.find((item) => item.id === record.userId && item.active);
    res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer');
    if (!user) return res.status(400).type('html').send(accountPage('Verification link expired', 'Request a new verification email and try again.'));
    return res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Verify email · Bhodhix</title></head><body style="font:16px system-ui;background:#0b0d14;color:#eef0fa;max-width:520px;margin:12vh auto;padding:24px"><h1>Verify your email</h1><p>Confirm this address to finish setting up your Bhodhix account.</p><form method="post" action="/api/auth/verify-email"><input type="hidden" name="token" value="${encodeURIComponent(req.query.token)}"><button style="padding:10px 16px">Verify email address</button></form></body></html>`);
  }

  function verifyEmail(req, res) {
    const record = tokenRecord(req.body?.token, 'verify');
    const user = record && store.users.find((item) => item.id === record.userId && item.active);
    res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer');
    if (!user) return res.status(400).type('html').send(accountPage('Verification link expired', 'Request a new verification email and try again.'));
    user.emailVerified = true;
    store.emailTokens = store.emailTokens.filter((item) => item.userId !== user.id && item.expiresAt > Date.now());
    save();
    return res.type('html').send(accountPage('Email verified', 'Your account is ready. Sign in to continue.'));
  }

  function showPasswordReset(req, res) {
    const record = tokenRecord(req.query?.token, 'reset');
    const user = record && store.users.find((item) => item.id === record.userId && item.active && item.emailVerified);
    res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer');
    if (!user) return res.status(400).type('html').send(accountPage('Reset link expired', 'Request another password reset link and try again.'));
    return res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Reset password · Bhodhix</title></head><body style="font:16px system-ui;background:#0b0d14;color:#eef0fa;max-width:520px;margin:12vh auto;padding:24px"><h1>Set a new password</h1><form method="post" action="/api/auth/reset-password"><input type="hidden" name="token" value="${encodeURIComponent(req.query.token)}"><label>New password (at least 12 characters)<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="new-password" style="display:block;width:100%;padding:12px;margin:8px 0 16px;box-sizing:border-box"></label><button style="padding:10px 16px">Update password</button></form></body></html>`);
  }

  function resetPassword(req, res, revokeConnections) {
    const record = tokenRecord(req.body?.token, 'reset');
    const user = record && store.users.find((item) => item.id === record.userId && item.active && item.emailVerified);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer');
    if (!user) return res.status(400).type('html').send(accountPage('Reset link expired', 'Request another password reset link and try again.'));
    if (password.length < 12 || password.length > 256) return res.status(400).type('html').send(accountPage('Password not changed', 'Use a password between 12 and 256 characters, then request another reset link.'));
    Object.assign(user, passwordRecord(password));
    store.sessions = store.sessions.filter((item) => item.userId !== user.id);
    store.emailTokens = store.emailTokens.filter((item) => item.userId !== user.id);
    revokeConnections?.(user.id);
    save();
    return res.type('html').send(accountPage('Password updated', 'Your password was changed. Sign in with the new password.'));
  }

  function updateRole(req, res) {
    const membership = store.memberships.find((item) => item.id === req.params.id && item.organizationId === req.organization.id && item.active);
    const role = req.body?.role;
    if (!membership || !ASSIGNABLE_ROLES.includes(role)) return fail(res, 404, 'Team member or role not found');
    if (membership.userId === req.user.id || membership.role === 'owner' || req.user.role !== 'owner' && (membership.role === 'admin' || role === 'admin')) return fail(res, 403, 'Only the owner can change administrator access');
    membership.role = role;
    save();
    return res.json({ success: true });
  }

  function updateProjectAccess(req, res) {
    const membership = store.memberships.find((item) => item.id === req.params.id && item.organizationId === req.organization.id && item.active);
    const projectIds = req.body?.projectIds;
    if (!membership || !Array.isArray(projectIds) || projectIds.length > 500 || projectIds.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id))) return fail(res, 400, 'Select valid project access');
    if (membership.role === 'owner') return fail(res, 403, 'Workspace owners always have access to all projects');
    membership.projectIds = [...new Set(projectIds)];
    save();
    return res.json({ success: true, projectIds: membership.projectIds });
  }

  function removeMember(req, res) {
    const membership = store.memberships.find((item) => item.id === req.params.id && item.organizationId === req.organization.id && item.active);
    if (!membership) return fail(res, 404, 'Team member not found');
    if (membership.userId === req.user.id || membership.role === 'owner' || req.user.role !== 'owner' && membership.role === 'admin') return fail(res, 403, 'This account cannot remove that team member');
    membership.active = false;
    store.sessions = store.sessions.filter((session) => session.membershipId !== membership.id);
    save();
    return res.json({ success: true });
  }

  function listInvites(req, res) {
    const invites = store.invites.filter((invite) => invite.organizationId === req.organization.id && !invite.usedAt && invite.expiresAt > Date.now()).map(({ codeHash, ...invite }) => invite);
    return res.json({ success: true, invites });
  }

  function revokeInvite(req, res) {
    store.invites = store.invites.filter((invite) => invite.id !== req.params.id || invite.organizationId !== req.organization.id);
    save();
    return res.json({ success: true });
  }

  const publicHost = process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).hostname.toLowerCase() : '';
  const configuredHosts = [...(process.env.ALLOWED_HOSTS || 'localhost,127.0.0.1,[::1]').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean), publicHost].filter(Boolean);
  const configuredOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  return {
    setupStatus, setupOwner, signup, login, requireAuth, requireRole, sessionValid, logout, listTeam, isActiveMember, memberCanAccessProject, memberWorkMode, administratorIds, memberName, updateWorkMode, notificationRecipients, createInvite, join, updateRole, updateProjectAccess, removeMember, listInvites, revokeInvite, authenticateMcpUser, getMcpIdentity,
    resendVerification, requestPasswordReset, showEmailVerification, verifyEmail, showPasswordReset, resetPassword,
    hostAllowed: (req, res, next) => {
      const requestHost = String(req.headers.host || '').toLowerCase();
      return configuredHosts.some((host) => requestHost === host || requestHost.startsWith(`${host}:`))
        ? next() : res.status(403).json({ success: false, error: 'Forbidden host' });
    },
    corsOptions: { origin: (origin, cb) => cb(null, !origin || LOCAL_ORIGIN_RE.test(origin) || configuredOrigins.includes(origin)) }
  };
}

module.exports = { loadPin, createAuth };
