const SHEET_NAME = 'Respostas ao formulário 1';
const OTP_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 30 * 60;
const OTP_COOLDOWN_SECONDS = 90;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

const PORTAL_HEADERS = {
  updatedAt: 'Última atualização no portal',
  status: 'Status do cadastro',
  proofDate: 'Data do comprovante',
  origin: 'Origem da atualização'
};

function setupPortal() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Abra a planilha do Clube e execute esta função em um projeto vinculado a ela.');

  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());

  const folderId = props.getProperty('PROOF_FOLDER_ID');
  if (!folderId) throw new Error('Defina a propriedade de script PROOF_FOLDER_ID antes de executar o setup.');
  DriveApp.getFolderById(folderId).getName();

  const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  ensurePortalHeaders_(sheet);
  validateSchema_(sheet);

  return 'Portal configurado com sucesso.';
}

function doGet() {
  return json_({ ok: true, service: 'Clube dos Estudantes de Odontologia de Minas Gerais', version: 2 });
}

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    const action = String(payload.action || '');

    switch (action) {
      case 'requestCode': return json_(requestCode_(payload));
      case 'verifyCode': return json_(verifyCode_(payload));
      case 'getProfile': return json_(getProfile_(payload));
      case 'completeProfile': return json_(completeProfile_(payload));
      case 'adminLogin': return json_(adminLogin_(payload));
      case 'adminData': return json_(adminData_(payload));
      default: return json_({ ok: false, error: 'Ação inválida.' });
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: safeError_(err) });
  }
}

function requestCode_(payload) {
  const email = normalizeEmail_(payload.email);
  if (!email) return { ok: true, message: genericCodeMessage_() };

  const sheet = getSheet_();
  const row = findStudentRowByEmail_(sheet, email);
  if (!row) return { ok: true, message: genericCodeMessage_() };

  const cache = CacheService.getScriptCache();
  const cooldownKey = cacheKey_('cooldown', email);
  if (!cache.get(cooldownKey)) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    cache.put(cacheKey_('otp', email), JSON.stringify({ code: code, attempts: 0 }), OTP_TTL_SECONDS);
    cache.put(cooldownKey, '1', OTP_COOLDOWN_SECONDS);

    const profile = readProfile_(sheet, row);
    sendOtpEmail_(email, profile.name, code);
  }

  return { ok: true, message: genericCodeMessage_() };
}

function verifyCode_(payload) {
  const email = normalizeEmail_(payload.email);
  const code = String(payload.code || '').replace(/\D/g, '').slice(0, 6);
  if (!email || code.length !== 6) return { ok: false, error: 'Código inválido ou expirado.' };

  const cache = CacheService.getScriptCache();
  const otpKey = cacheKey_('otp', email);
  const raw = cache.get(otpKey);
  if (!raw) return { ok: false, error: 'Código inválido ou expirado. Solicite um novo código.' };

  const otp = JSON.parse(raw);
  if (otp.code !== code) {
    otp.attempts = Number(otp.attempts || 0) + 1;
    if (otp.attempts >= 5) cache.remove(otpKey);
    else cache.put(otpKey, JSON.stringify(otp), OTP_TTL_SECONDS);
    return { ok: false, error: 'Código inválido ou expirado.' };
  }

  const sheet = getSheet_();
  const row = findStudentRowByEmail_(sheet, email);
  if (!row) return { ok: false, error: 'Cadastro não localizado.' };

  cache.remove(otpKey);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put(cacheKey_('session', token), email, SESSION_TTL_SECONDS);

  return { ok: true, token: token, profile: readProfile_(sheet, row) };
}

function getProfile_(payload) {
  const email = requireStudentSession_(payload.token);
  const sheet = getSheet_();
  const row = findStudentRowByEmail_(sheet, email);
  if (!row) throw new Error('Cadastro não localizado.');
  return { ok: true, profile: readProfile_(sheet, row) };
}

function completeProfile_(payload) {
  const email = requireStudentSession_(payload.token);
  const address = payload.address || {};

  const street = clean_(address.street, 180);
  const cep = clean_(address.cep, 12);
  const number = clean_(address.number, 30);
  const complement = clean_(address.complement, 120);
  const city = clean_(address.city, 100);
  const neighborhood = clean_(address.neighborhood, 100);

  if (!street || !cep || !number || !city || !neighborhood) {
    throw new Error('Preencha endereço, CEP, número, cidade e bairro.');
  }
  if (cep.replace(/\D/g, '').length !== 8) throw new Error('Informe um CEP válido com 8 dígitos.');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet_();
    const row = findStudentRowByEmail_(sheet, email);
    if (!row) throw new Error('Cadastro não localizado.');

    const cols = columns_(sheet);
    const current = readProfile_(sheet, row);
    let proofUrl = current.hasProof ? getCellDisplay_(sheet, row, cols.proof) : '';
    let uploadedProof = false;

    if (payload.file && payload.file.base64) {
      proofUrl = uploadProof_(payload.file, current.name, email);
      uploadedProof = true;
    }

    if (!proofUrl) throw new Error('Envie um comprovante de matrícula atualizado.');

    setCell_(sheet, row, cols.address, street);
    setCell_(sheet, row, cols.cep, cep);
    setCell_(sheet, row, cols.number, number);
    setCell_(sheet, row, cols.complement, complement);
    setCell_(sheet, row, cols.addressCity, city);
    setCell_(sheet, row, cols.neighborhood, neighborhood);
    setCell_(sheet, row, cols.proof, proofUrl);

    const now = new Date();
    setCell_(sheet, row, cols.portalUpdatedAt, now);
    setCell_(sheet, row, cols.portalStatus, 'Cadastro completo');
    if (uploadedProof) setCell_(sheet, row, cols.portalProofDate, now);
    setCell_(sheet, row, cols.portalOrigin, 'Portal Clube');

    return { ok: true, profile: readProfile_(sheet, row) };
  } finally {
    lock.releaseLock();
  }
}

function adminLogin_(payload) {
  const configured = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!configured) throw new Error('A área administrativa ainda não foi configurada.');
  if (String(payload.password || '') !== configured) return { ok: false, error: 'Senha administrativa inválida.' };

  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put(cacheKey_('admin', token), '1', SESSION_TTL_SECONDS);
  return { ok: true, token: token };
}

function adminData_(payload) {
  requireAdminSession_(payload.token);
  const sheet = getSheet_();
  const cols = columns_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, stats: emptyStats_(), students: [] };

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
  const latestByEmail = {};

  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    const email = normalizeEmail_(row[cols.email - 1]);
    if (!email || latestByEmail[email]) continue;
    latestByEmail[email] = row;
  }

  const students = Object.keys(latestByEmail).map(function(email) {
    const row = latestByEmail[email];
    const required = [cols.address, cols.cep, cols.number, cols.addressCity, cols.neighborhood, cols.proof];
    const done = required.filter(function(c) { return clean_(row[c - 1], 1000) !== ''; }).length;
    const progress = Math.round(done / required.length * 100);
    return {
      name: row[cols.name - 1] || '',
      email: row[cols.email - 1] || '',
      phone: row[cols.phone - 1] || '',
      city: row[cols.city - 1] || '',
      institution: row[cols.institution - 1] || '',
      period: row[cols.period - 1] || '',
      complete: progress === 100,
      progress: progress,
      hasProof: Boolean(row[cols.proof - 1]),
      updatedAt: row[cols.portalUpdatedAt - 1] || ''
    };
  }).sort(function(a, b) { return a.name.localeCompare(b.name, 'pt-BR'); });

  const stats = {
    total: students.length,
    complete: students.filter(function(s) { return s.complete; }).length,
    pending: students.filter(function(s) { return !s.complete; }).length,
    withProof: students.filter(function(s) { return s.hasProof; }).length,
    withoutProof: students.filter(function(s) { return !s.hasProof; }).length
  };

  return { ok: true, stats: stats, students: students };
}

function getSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Backend não configurado: execute setupPortal() primeiro.');
  const ss = SpreadsheetApp.openById(id);
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  ensurePortalHeaders_(sheet);
  validateSchema_(sheet);
  return sheet;
}

function ensurePortalHeaders_(sheet) {
  let lastCol = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  Object.keys(PORTAL_HEADERS).forEach(function(key) {
    const label = PORTAL_HEADERS[key];
    if (findHeader_(headers, label, false) === -1) {
      lastCol += 1;
      sheet.getRange(1, lastCol).setValue(label);
      headers.push(label);
    }
  });
}

function validateSchema_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  ['Nome completo', 'Telefone', 'E-mail', 'Instituição de ensino', 'Período da graduação', 'Endereço', 'CEP', 'Número', 'Complemento', 'Bairro', 'Comprovante de matrícula (Atualizado)'].forEach(function(label) {
    if (findHeader_(headers, label, false) === -1) throw new Error('Coluna obrigatória não encontrada: ' + label);
  });
  if (findHeader_(headers, 'Cidade', true) === -1) throw new Error('Coluna de cidade não encontrada.');
}

function columns_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  return {
    name: requireHeader_(headers, 'Nome completo'),
    phone: requireHeader_(headers, 'Telefone'),
    email: requireHeader_(headers, 'E-mail'),
    city: requireHeader_(headers, 'Cidade'),
    institution: requireHeader_(headers, 'Instituição de ensino'),
    level: requireHeader_(headers, 'Está cursando qual nível de ensino atualmente?'),
    period: requireHeader_(headers, 'Período da graduação'),
    address: requireHeader_(headers, 'Endereço'),
    cep: requireHeader_(headers, 'CEP'),
    number: requireHeader_(headers, 'Número'),
    complement: requireHeader_(headers, 'Complemento'),
    addressCity: requireHeader_(headers, 'Cidade', true),
    neighborhood: requireHeader_(headers, 'Bairro'),
    proof: requireHeader_(headers, 'Comprovante de matrícula (Atualizado)'),
    portalUpdatedAt: requireHeader_(headers, PORTAL_HEADERS.updatedAt),
    portalStatus: requireHeader_(headers, PORTAL_HEADERS.status),
    portalProofDate: requireHeader_(headers, PORTAL_HEADERS.proofDate),
    portalOrigin: requireHeader_(headers, PORTAL_HEADERS.origin)
  };
}

function requireHeader_(headers, label, last) {
  const idx = findHeader_(headers, label, Boolean(last));
  if (idx === -1) throw new Error('Coluna obrigatória não encontrada: ' + label);
  return idx + 1;
}

function findHeader_(headers, label, last) {
  const target = normalizeText_(label);
  if (last) {
    for (let i = headers.length - 1; i >= 0; i--) if (normalizeText_(headers[i]) === target) return i;
    return -1;
  }
  for (let i = 0; i < headers.length; i++) if (normalizeText_(headers[i]) === target) return i;
  return -1;
}

function findStudentRowByEmail_(sheet, email) {
  const cols = columns_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const emails = sheet.getRange(2, cols.email, lastRow - 1, 1).getDisplayValues();
  for (let i = emails.length - 1; i >= 0; i--) {
    if (normalizeEmail_(emails[i][0]) === email) return i + 2;
  }
  return 0;
}

function readProfile_(sheet, rowNumber) {
  const cols = columns_(sheet);
  const row = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const required = [cols.address, cols.cep, cols.number, cols.addressCity, cols.neighborhood, cols.proof];
  const done = required.filter(function(c) { return clean_(row[c - 1], 1000) !== ''; }).length;
  const progress = Math.round(done / required.length * 100);

  return {
    name: row[cols.name - 1] || '',
    phone: row[cols.phone - 1] || '',
    email: row[cols.email - 1] || '',
    city: row[cols.city - 1] || '',
    institution: row[cols.institution - 1] || '',
    level: row[cols.level - 1] || '',
    period: row[cols.period - 1] || '',
    address: row[cols.address - 1] || '',
    cep: row[cols.cep - 1] || '',
    number: row[cols.number - 1] || '',
    complement: row[cols.complement - 1] || '',
    addressCity: row[cols.addressCity - 1] || '',
    neighborhood: row[cols.neighborhood - 1] || '',
    hasProof: Boolean(row[cols.proof - 1]),
    complete: progress === 100,
    progress: progress,
    updatedAt: row[cols.portalUpdatedAt - 1] || ''
  };
}

function uploadProof_(file, studentName, email) {
  const folderId = PropertiesService.getScriptProperties().getProperty('PROOF_FOLDER_ID');
  if (!folderId) throw new Error('Pasta de comprovantes não configurada.');

  const mime = String(file.mimeType || '').toLowerCase();
  if (ALLOWED_FILE_TYPES.indexOf(mime) === -1) throw new Error('Formato não permitido. Envie PDF, JPG ou PNG.');

  const raw = String(file.base64 || '').replace(/^data:[^;]+;base64,/, '');
  const bytes = Utilities.base64Decode(raw);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('O arquivo deve ter no máximo 5 MB.');

  const extension = mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : '.jpg';
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Sao_Paulo', 'yyyyMMdd-HHmmss');
  const safeName = cleanFileName_(studentName || email.split('@')[0]);
  const name = 'matricula_' + safeName + '_' + stamp + extension;
  const blob = Utilities.newBlob(bytes, mime, name);
  const created = DriveApp.getFolderById(folderId).createFile(blob);
  return created.getUrl();
}

function requireStudentSession_(token) {
  const t = String(token || '');
  const email = t ? CacheService.getScriptCache().get(cacheKey_('session', t)) : '';
  if (!email) throw new Error('Sua sessão expirou. Entre novamente usando seu e-mail.');
  CacheService.getScriptCache().put(cacheKey_('session', t), email, SESSION_TTL_SECONDS);
  return email;
}

function requireAdminSession_(token) {
  const t = String(token || '');
  if (!t || !CacheService.getScriptCache().get(cacheKey_('admin', t))) throw new Error('Sessão administrativa expirada.');
  CacheService.getScriptCache().put(cacheKey_('admin', t), '1', SESSION_TTL_SECONDS);
}

function sendOtpEmail_(email, name, code) {
  const firstName = clean_(name, 120).split(/\s+/)[0] || 'estudante';
  const subject = 'Código de acesso — Clube dos Estudantes de Odontologia';
  const body = 'Olá, ' + firstName + '!\n\nSeu código de acesso ao portal do Clube dos Estudantes é: ' + code + '\n\nO código expira em 10 minutos.\n\nSe você não solicitou este acesso, ignore esta mensagem.';
  const html = '<p>Olá, <strong>' + htmlEscape_(firstName) + '</strong>!</p>' +
    '<p>Seu código de acesso ao portal do Clube dos Estudantes é:</p>' +
    '<p style="font-size:30px;font-weight:800;letter-spacing:6px">' + code + '</p>' +
    '<p>O código expira em 10 minutos.</p>' +
    '<p style="color:#777">Se você não solicitou este acesso, ignore esta mensagem.</p>';
  MailApp.sendEmail({ to: email, subject: subject, body: body, htmlBody: html, name: 'Clube dos Estudantes de Odontologia de Minas Gerais' });
}

function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try { return JSON.parse(e.postData.contents); }
  catch (_) { return e.parameter || {}; }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function setCell_(sheet, row, col, value) {
  if (!col) return;
  sheet.getRange(row, col).setValue(value);
}

function getCellDisplay_(sheet, row, col) {
  return col ? sheet.getRange(row, col).getDisplayValue() : '';
}

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeText_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function clean_(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max || 500);
}

function cleanFileName_(value) {
  return normalizeText_(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'estudante';
}

function cacheKey_(prefix, value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return prefix + ':' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function genericCodeMessage_() {
  return 'Se este e-mail estiver cadastrado no Clube, você receberá um código de acesso em alguns instantes.';
}

function safeError_(err) {
  const msg = err && err.message ? String(err.message) : 'Não foi possível concluir a solicitação.';
  return msg.slice(0, 240);
}

function emptyStats_() {
  return { total: 0, complete: 0, pending: 0, withProof: 0, withoutProof: 0 };
}

function htmlEscape_(value) {
  return String(value || '').replace(/[&<>"']/g, function(ch) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
  });
}
