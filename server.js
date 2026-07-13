const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const app = express();
const PORT = 3000;
const CLIENT_ID = require('os').hostname();
const AUTH_API_HOST = 'testvv22.vercel.app';
const AUTH_API_PATH = '/api/auth';

function setLogVercel(username, log) {
  if (!username) return;
  httpPost(AUTH_API_HOST, AUTH_API_PATH, { action: 'setLog', nickname: username, log }).catch(() => {});
}

function httpPost(host, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: host,
      path: apiPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function callVercelAPI(action, nickname, password, license) {
  const body = { action, nickname, password, client: CLIENT_ID };
  if (license) body.license = license;
  return httpPost(AUTH_API_HOST, AUTH_API_PATH, body);
}

function callJunkieAPI(key) {
  return httpPost('api.jnkie.com', '/api/v1/whitelist/verifyOpen', {
    key: key.trim(), service: "Apxion", identifier: "1150240"
  }).then(result => {
    if (!result) return { valid: false, message: 'No response from Junkie' };
    if (result.valid && (result.message === 'KEY_VALID' || result.message === 'KEYLESS')) {
      return { valid: true, info: result };
    }
    const raw = result.message || result.error || 'Invalid key';
    const friendly = {
      'KEY_INVALID': 'License Invalid',
      'KEY_EXPIRED': 'License Expired',
      'KEY_IN_USE': 'License already in use on another PC',
      'KEY_ALREADY_USED': 'License already in use on another PC',
      'KEY_HWID_MISMATCH': 'License already in use on another PC'
    }[raw] || raw;
    return { valid: false, message: friendly };
  }).catch(e => ({ valid: false, message: e.message }));
}

const AUTH_FILE = path.join(process.env.TEMP || '.', 'Axyst', 'auth.json');
const LOG_FILE = path.join(process.env.TEMP || '.', 'Vykron', 'server.log');
// Detect correct Documents folder (OneDrive or regular)
const oneDriveDocs = path.join(process.env.USERPROFILE || '.', 'OneDrive', 'Documents');
const regularDocs = path.join(process.env.USERPROFILE || '.', 'Documents');
const SETTINGS_DIR = path.join((fs.existsSync(oneDriveDocs) ? oneDriveDocs : regularDocs), 'Vykron');

function logToFile(message) {
  try {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    const logDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(LOG_FILE, logMessage);
  } catch (e) {
    console.log('Error writing to log file:', e);
  }
}

function checkAuth() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const d = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
      if (d.username) return d;
    }
  } catch {}
  return null;
}
function saveAuth(username, password, license_key) {
  try {
    const dir = path.dirname(AUTH_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ username, password, license_key }));
  } catch {}
}
function getProfileFile(profileName) {
  if (!profileName) return null;
  if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  return path.join(SETTINGS_DIR, `${profileName}.json`);
}
function loadProfile(profileName) {
  try {
    const file = getProfileFile(profileName);
    if (file && fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.active = false;
      data.show_fov_overlay = false;
      return data;
    }
  } catch {}
  return null;
}
function saveProfile(profileName, profileData) {
  try {
    logToFile('saveProfile called for: ' + profileName);
    const file = getProfileFile(profileName);
    if (file) {
      fs.writeFileSync(file, JSON.stringify(profileData, null, 2));
      logToFile('Profile saved successfully');
    }
  } catch (e) {
    logToFile('Error saving profile: ' + e.message);
  }
}
function loadUserSettings(username) {
  try {
    // Load all profiles from SETTINGS_DIR
    if (!fs.existsSync(SETTINGS_DIR)) return null;
    const files = fs.readdirSync(SETTINGS_DIR).filter(f => f.endsWith('.json'));
    const profiles = {};
    for (const file of files) {
      const profileName = path.basename(file, '.json');
      const profileData = loadProfile(profileName);
      if (profileData) {
        profiles[profileName] = profileData;
      }
    }
    if (Object.keys(profiles).length > 0) {
      return {
        username: username,
        profiles: profiles,
        current_profile: "Default"
      };
    }
  } catch {}
  return null;
}
function saveUserSettings(username, sessionData) {
  try {
    logToFile('saveUserSettings called for: ' + username);

    if (sessionData && sessionData.profiles) {
      for (const profileName in sessionData.profiles) {
        saveProfile(profileName, sessionData.profiles[profileName]);
      }
    }
  } catch (e) {
    logToFile('Error saving user settings: ' + e.message);
  }
}

let realStatus = null;

function scanModels() {
  const dirs = [
    process.env.MODELS_PATH, // Prioridad máxima: variable de entorno
    path.join(process.env.USERPROFILE, 'Documents'), // Busca directamente en Documents
    path.join(process.env.USERPROFILE, 'Documents', 'VykronAI', 'models') // Estructura antigua (fallback)
  ].filter(Boolean);

  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      const models = files.filter(f => (f.endsWith('.onnx') || f.endsWith('.pt')) && !f.toUpperCase().includes('DERANGED'))
                         .map(f => f.replace(/\.(onnx|pt)$/i, ''));
      if (models.length > 0) return models;
    } catch {}
  }
  return [];
}

// In-memory database of registered users
let users = {
  "admin": {
    password: "admin",
    license: "TEST-KEYY-1111-2222",
    profiles: {
      "Default": {
        "active": false,
        "body_target": "Chest",
        "custom_body_pct": 50,
        "trigger_mode": "LT",
        "virtual_ctrl_type": "Xbox 360",
        "ms_0_30": 3000,
        "ms_30_60": 12000,
        "ms_60_90": 24000,
        "ms_90p": 30000,
        "smooth_damping": 0.85,
        "deadzone_px": 0,
        "stick_limit": 100,
        "flick_power": 100,
        "snap_mode": "Per Trigger",
        "current_model_name": "",
        "show_fov_overlay": false,
        "fov_px": 80,
        "esp_conf": 0.33,
        "fov_color": "#ffffff",
        "fov_style": "solid",
        "fov_fill": 0
      },
      "Legit Aimbot": {
        "active": false,
        "body_target": "Chest",
        "custom_body_pct": 50,
        "trigger_mode": "LT",
        "virtual_ctrl_type": "Xbox 360",
        "ms_0_30": 1500,
        "ms_30_60": 8000,
        "ms_60_90": 18000,
        "ms_90p": 25000,
        "smooth_damping": 0.92,
        "deadzone_px": 2,
        "stick_limit": 80,
        "flick_power": 40,
        "snap_mode": "Per Trigger",
        "current_model_name": "",
        "show_fov_overlay": true,
        "fov_px": 60,
        "esp_conf": 0.45,
        "fov_color": "#ffffff",
        "fov_style": "solid",
        "fov_fill": 0
      }
    },
    current_profile: "Default"
  }
};

// Global active session for testing convenience
let activeSession = null;

const DEFAULT_SETTINGS = {
  "active": false,
  "body_target": "Chest",
  "custom_body_pct": 50,
  "trigger_mode": "LT",
  "virtual_ctrl_type": "Xbox 360",
  "ms_0_30": 3000,
  "ms_30_60": 12000,
  "ms_60_90": 24000,
  "ms_90p": 30000,
  "smooth_damping": 0.85,
  "deadzone_px": 0,
  "stick_limit": 100,
  "flick_power": 100,
  "snap_mode": "Per Trigger",
  "current_model_name": "",
  "show_fov_overlay": false,
  "fov_px": 80,
  "esp_conf": 0.33,
  "fov_color": "#ffffff",
  "fov_style": "solid",
  "fov_fill": 0
};

function getSettingsResponse(userObj) {
  const profileName = userObj.current_profile || "Default";
  const p = userObj.profiles[profileName] || DEFAULT_SETTINGS;
  return {
    "ok": true,
    "active-cb": p.active,
    "body-cb": p.body_target,
    "body-sl": p.custom_body_pct,
    "trig-cb": p.trigger_mode,
    "virt-cb": p.virtual_ctrl_type,
    "ms-0-30": p.ms_0_30,
    "ms-30-60": p.ms_30_60,
    "ms-60-90": p.ms_60_90,
    "ms-90p": p.ms_90p,
    "sm-damping": p.smooth_damping,
    "deadzone": p.deadzone_px,
    "stick-limit": p.stick_limit,
    "flick-power": p.flick_power,
    "snap-mode": p.snap_mode,
    "model-cb": p.current_model_name,
    "fov-cb": p.show_fov_overlay,
    "fov-sl": p.fov_px,
    "conf-sl": p.esp_conf,
    "body_target": p.body_target,
    "current_profile": profileName,
    "active": p.active,
    "custom_body_pct": p.custom_body_pct,
    "trigger_mode": p.trigger_mode,
    "virtual_ctrl_type": p.virtual_ctrl_type,
    "ms_0_30": p.ms_0_30,
    "ms_30_60": p.ms_30_60,
    "ms_60_90": p.ms_60_90,
    "ms_90p": p.ms_90p,
    "smooth_damping": p.smooth_damping,
    "deadzone_px": p.deadzone_px,
    "stick_limit": p.stick_limit,
    "flick_power": p.flick_power,
    "snap_mode": p.snap_mode,
    "current_model_name": p.current_model_name,
    "show_fov_overlay": p.show_fov_overlay,
    "fov_px": p.fov_px,
    "esp_conf": p.esp_conf,
    "fov_color": p.fov_color,
    "fov_style": p.fov_style,
    "fov_fill": p.fov_fill
  };
}

function mapIncomingSettings(body) {
  const p = {};
  p.active = body.active !== undefined ? body.active : (body['active-cb'] !== undefined ? body['active-cb'] : undefined);
  p.body_target = body.body_target !== undefined ? body.body_target : (body['body-cb'] !== undefined ? body['body-cb'] : undefined);
  p.custom_body_pct = body.custom_body_pct !== undefined ? body.custom_body_pct : (body['body-sl'] !== undefined ? Number(body['body-sl']) : undefined);
  p.trigger_mode = body.trigger_mode !== undefined ? body.trigger_mode : (body['trig-cb'] !== undefined ? body['trig-cb'] : undefined);
  p.virtual_ctrl_type = body.virtual_ctrl_type !== undefined ? body.virtual_ctrl_type : (body['virt-cb'] !== undefined ? body['virt-cb'] : undefined);
  p.ms_0_30 = body.ms_0_30 !== undefined ? Number(body.ms_0_30) : (body['ms-0-30'] !== undefined ? Number(body['ms-0-30']) : undefined);
  p.ms_30_60 = body.ms_30_60 !== undefined ? Number(body.ms_30_60) : (body['ms-30-60'] !== undefined ? Number(body['ms-30-60']) : undefined);
  p.ms_60_90 = body.ms_60_90 !== undefined ? Number(body.ms_60_90) : (body['ms-60-90'] !== undefined ? Number(body['ms-60-90']) : undefined);
  p.ms_90p = body.ms_90p !== undefined ? Number(body.ms_90p) : (body['ms-90p'] !== undefined ? Number(body['ms-90p']) : undefined);
  p.smooth_damping = body.smooth_damping !== undefined ? Number(body.smooth_damping) : (body['sm-damping'] !== undefined ? Number(body['sm-damping']) : undefined);
  p.deadzone_px = body.deadzone_px !== undefined ? Number(body.deadzone_px) : (body['deadzone'] !== undefined ? Number(body['deadzone']) : undefined);
  p.stick_limit = body.stick_limit !== undefined ? Number(body.stick_limit) : (body['stick-limit'] !== undefined ? Number(body['stick-limit']) : undefined);
  p.flick_power = body.flick_power !== undefined ? Number(body.flick_power) : (body['flick-power'] !== undefined ? Number(body['flick-power']) : undefined);
  p.snap_mode = body.snap_mode !== undefined ? body.snap_mode : (body['snap-mode'] !== undefined ? body['snap-mode'] : undefined);
  p.current_model_name = body.current_model_name !== undefined ? body.current_model_name : (body['model-cb'] !== undefined ? body['model-cb'] : undefined);
  p.show_fov_overlay = body.show_fov_overlay !== undefined ? body.show_fov_overlay : (body['fov-cb'] !== undefined ? body['fov-cb'] : undefined);
  p.fov_px = body.fov_px !== undefined ? Number(body.fov_px) : (body['fov-sl'] !== undefined ? Number(body['fov-sl']) : undefined);
  p.esp_conf = body.esp_conf !== undefined ? Number(body.esp_conf) : (body['conf-sl'] !== undefined ? Number(body['conf-sl']) : undefined);
  p.fov_color = body.fov_color !== undefined ? body.fov_color : undefined;
  p.fov_style = body.fov_style !== undefined ? body.fov_style : undefined;
  p.fov_fill = body.fov_fill !== undefined ? Number(body.fov_fill) : undefined;

  const result = {};
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

// Auth Login endpoint (accepts either username/password or just license)
app.post('/api/auth/login', async (req, res) => {
  const { username, password, license } = req.body;

  // License key login
  if (license) {
    try {
      const lr = await callJunkieAPI(license);
      if (lr.valid) {
        const uname = username || 'Vykron';
        saveAuth(uname, password || '', license.trim());
        // Load saved settings or use defaults
        const savedSettings = loadUserSettings(uname);
        activeSession = savedSettings || {
          username: uname,
          license: license.trim(),
          profiles: { "Default": { ...DEFAULT_SETTINGS } },
          current_profile: "Default"
        };
        activeSession.username = uname;
        activeSession.license = license.trim();
        setLogVercel(uname, 'Active Now');
        return res.json({ ok: true, session: { username: uname, license: license.trim() } });
      }
      return res.json({ ok: false, message: lr.message || 'Invalid key' });
    } catch (e) {
      return res.json({ ok: false, message: 'Connection error: ' + e.message });
    }
  }

  // Username/password login via Vercel
  if (username && password) {
    const u = username.trim();
    const p = password;
    try {
      const result = await callVercelAPI('login', u, p);
      if (!result) return res.json({ ok: false, message: 'No response from auth server' });

      if (result.message === 'Reset HWID') {
        const savedLicense = result.savedLicense || '';
        if (savedLicense) {
          const lr = await callJunkieAPI(savedLicense);
          if (lr.valid) {
            saveAuth(u, p, savedLicense);
            const savedSettings = loadUserSettings(u);
            activeSession = savedSettings || {
              username: u, license: savedLicense,
              profiles: { "Default": { ...DEFAULT_SETTINGS } },
              current_profile: "Default"
            };
            activeSession.username = u;
            activeSession.license = savedLicense;
            setLogVercel(u, 'Active Now');
            return res.json({ ok: true, session: { username: u, license: savedLicense } });
          }
          const msg = (lr.message || '').toLowerCase();
          if (msg.includes('expired')) {
            return res.json({ ok: false, message: 'License expired. Enter a new key.', redeem: true });
          }
          if (msg.includes('in use') || msg.includes('already') || msg.includes('hwid')) {
            return res.json({ ok: false, message: 'License already in use on another PC. Use redeem option.', redeem: true });
          }
        }
        return res.json({ ok: false, message: 'HWID changed. Enter your license key to reactivate.', redeem: true });
      }

      if (result.message === 'Wrong credentials') {
        const saved = checkAuth();
        if (saved && saved.username === u) {
          const lr = await callJunkieAPI(saved.license_key);
          if (lr.valid) {
            const savedSettings = loadUserSettings(u);
            activeSession = savedSettings || {
              username: u, license: saved.license_key,
              profiles: { "Default": { ...DEFAULT_SETTINGS } },
              current_profile: "Default"
            };
            activeSession.username = u;
            activeSession.license = saved.license_key;
            setLogVercel(u, 'Active Now');
            return res.json({ ok: true, session: { username: u, license: saved.license_key } });
          }
        }
        return res.json({ ok: false, message: 'Wrong credentials' });
      }

      if (result.license) {
        const lk = result.license;
        const lr = await callJunkieAPI(lk);
        if (!lr.valid) {
          const msg = (lr.message || '').toLowerCase();
          if (msg.includes('in use') || msg.includes('already') || msg.includes('hwid')) {
            return res.json({ ok: false, message: 'License already in use on another PC. Use redeem option.', redeem: true });
          }
          return res.json({ ok: false, message: 'License expired. Enter a new key.', redeem: true });
        }
        saveAuth(u, p, lk);
        const savedSettings = loadUserSettings(u);
        activeSession = savedSettings || {
          username: u, license: lk,
          profiles: { "Default": { ...DEFAULT_SETTINGS } },
          current_profile: "Default"
        };
        activeSession.username = u;
        activeSession.license = lk;
        setLogVercel(u, 'Active Now');
        return res.json({ ok: true, session: { username: u, license: lk } });
      }

      // When Vercel says "License expired", re-check saved license ourselves
      // because Vercel might misreport "in use" as "expired"
      if (result.message === 'License expired' || (result.message && result.message.toLowerCase().includes('expired'))) {
        const saved = checkAuth();
        if (saved && saved.license_key) {
          const lr = await callJunkieAPI(saved.license_key);
          if (lr.valid) {
            saveAuth(u, p, saved.license_key);
            const savedSettings = loadUserSettings(u);
            activeSession = savedSettings || {
              username: u, license: saved.license_key,
              profiles: { "Default": { ...DEFAULT_SETTINGS } },
              current_profile: "Default"
            };
            activeSession.username = u;
            activeSession.license = saved.license_key;
            setLogVercel(u, 'Active Now');
            return res.json({ ok: true, session: { username: u, license: saved.license_key } });
          }
          const msg = (lr.message || '').toLowerCase();
          if (msg.includes('in use') || msg.includes('already') || msg.includes('hwid')) {
            return res.json({ ok: false, message: 'License already in use on another PC. Use redeem option.', redeem: true });
          }
        }
        return res.json({ ok: false, message: 'License expired. Enter a new key.', redeem: true });
      }

      return res.json({ ok: false, message: result.message || 'Login failed', redeem: true });
    } catch (e) {
      return res.json({ ok: false, message: 'Connection error: ' + e.message });
    }
  }

  return res.json({ ok: false, message: 'Missing credentials.' });
});

// Auth Register endpoint
app.post('/api/auth/register', async (req, res) => {
  const { username, password, license } = req.body;
  if (!username || !password || !license) {
    return res.json({ ok: false, message: 'Please fill out all fields.' });
  }
  const u = username.trim();
  const lk = license.trim();
  try {
    const lr = await callJunkieAPI(lk);
    if (!lr.valid) return res.json({ ok: false, message: 'Invalid license key' });
    const result = await callVercelAPI('register', u, password, lk);
    if (result && result.message === 'Already used on this PC') {
      await callVercelAPI('login', u, password, lk);
      saveAuth(u, password, lk);
      const savedSettings = loadUserSettings(u);
      activeSession = savedSettings || { username: u, license: lk, profiles: { "Default": { ...DEFAULT_SETTINGS } }, current_profile: "Default" };
      activeSession.username = u;
      activeSession.license = lk;
      setLogVercel(u, 'Active Now');
      return res.json({ ok: true, message: 'License updated for existing user' });
    }
    if (result && result.message === 'Username taken') {
      return res.json({ ok: false, message: 'Username already in use' });
    }
    if (result && result.error) return res.json({ ok: false, message: result.error });
    saveAuth(u, password, lk);
    const savedSettings = loadUserSettings(u);
    activeSession = savedSettings || { username: u, license: lk, profiles: { "Default": { ...DEFAULT_SETTINGS } }, current_profile: "Default" };
    activeSession.username = u;
    activeSession.license = lk;
    setLogVercel(u, 'Active Now');
    return res.json({ ok: true, message: 'Account created' });
  } catch (e) {
    return res.json({ ok: false, message: 'Connection error' });
  }
});

// Redeem expired license key
app.post('/api/auth/redeem', async (req, res) => {
  const { license, session: reqSession } = req.body;
  const lk = (license || '').trim();
  if (!lk) return res.json({ ok: false, message: 'License key required.' });
  try {
    const lr = await callJunkieAPI(lk);
    if (!lr.valid) return res.json({ ok: false, message: lr.message || 'Invalid key' });
    const username = reqSession?.username || '';
    const password = reqSession?.password || '';
    if (username && password) {
      await callVercelAPI('login', username.trim(), password, lk);
      saveAuth(username.trim(), password, lk);
    } else {
      saveAuth('key_user', '', lk);
    }
    const finalUsername = username || 'key_user';
    const savedSettings = loadUserSettings(finalUsername);
    activeSession = savedSettings || { username: finalUsername, license: lk, profiles: { "Default": { ...DEFAULT_SETTINGS } }, current_profile: "Default" };
    activeSession.username = finalUsername;
    activeSession.license = lk;
    setLogVercel(activeSession.username, 'Active Now');
    return res.json({ ok: true, session: { username: activeSession.username, license: lk } });
  } catch (e) {
    return res.json({ ok: false, message: 'Connection error' });
  }
});

// Python engine's full state (pushed periodically)
let pythonState = null;

// POST Python engine's full state
app.post('/api/state', (req, res) => {
  pythonState = { ...req.body, timestamp: Date.now() };
  res.json({ ok: true });
});

// POST Settings updates (store user changes + update pythonState directly)
app.post('/api/settings', (req, res) => {
  const s = req.body;
  if (!activeSession) {
    activeSession = { username: "Guest", license: "TEMP", profiles: { "Default": { ...DEFAULT_SETTINGS } }, current_profile: "Default" };
  }
  const profileName = activeSession.current_profile || "Default";
  if (!activeSession.profiles[profileName]) activeSession.profiles[profileName] = { ...DEFAULT_SETTINGS };
  const p = activeSession.profiles[profileName];
  if (s.active !== undefined) {
    if (s.active === true && (!activeSession.username || activeSession.username === "Guest")) {
      p.active = false;
    } else {
      p.active = s.active;
    }
  }
  if (s.body_target !== undefined) p.body_target = s.body_target;
  if (s.custom_body_pct !== undefined) p.custom_body_pct = s.custom_body_pct;
  if (s.trigger_mode !== undefined) p.trigger_mode = s.trigger_mode;
  if (s.virtual_ctrl_type !== undefined) p.virtual_ctrl_type = s.virtual_ctrl_type;
  if (s.ms_0_30 !== undefined) p.ms_0_30 = s.ms_0_30;
  if (s.ms_30_60 !== undefined) p.ms_30_60 = s.ms_30_60;
  if (s.ms_60_90 !== undefined) p.ms_60_90 = s.ms_60_90;
  if (s.ms_90p !== undefined) p.ms_90p = s.ms_90p;
  if (s.smooth_damping !== undefined) p.smooth_damping = s.smooth_damping;
  if (s.deadzone_px !== undefined) p.deadzone_px = s.deadzone_px;
  if (s.stick_limit !== undefined) p.stick_limit = s.stick_limit;
  if (s.flick_power !== undefined) p.flick_power = s.flick_power;
  if (s.snap_mode !== undefined) p.snap_mode = s.snap_mode;
  if (s.current_model_name !== undefined) p.current_model_name = s.current_model_name;
  if (s.show_fov_overlay !== undefined) p.show_fov_overlay = s.show_fov_overlay;
  if (s.fov_px !== undefined) p.fov_px = s.fov_px;
  if (s.esp_conf !== undefined) p.esp_conf = s.esp_conf;
  if (s.fov_color !== undefined) p.fov_color = s.fov_color;
  if (s.fov_style !== undefined) p.fov_style = s.fov_style;
  if (s.fov_fill !== undefined) p.fov_fill = s.fov_fill;
  if (s.current_profile !== undefined) {
    const next = s.current_profile;
    if (!activeSession.profiles[next]) activeSession.profiles[next] = { ...DEFAULT_SETTINGS };
    activeSession.current_profile = next;
  }
  if (pythonState) {
    for (const [k, v] of Object.entries(s)) {
      if (v !== undefined) pythonState[k] = v;
    }
    pythonState.timestamp = Date.now();
  }
  
  // Guardar todos los perfiles EN DISCO (incluyendo el nuevo)
  if (activeSession && activeSession.username && activeSession.username !== "Guest") {
    saveUserSettings(activeSession.username, activeSession);
  }
  
  // Forward a Python
  const fwdBody = JSON.stringify(s);
  const fwdReq = http.request({ hostname: '127.0.0.1', port: 5001, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(fwdBody) } });
  fwdReq.on('error', () => {});
  fwdReq.write(fwdBody);
  fwdReq.end();
  return res.json({ ok: true });
});

// GET Settings: merge activeSession changes into pythonState, or fallback
app.get('/api/settings', (req, res) => {
  // Get base from activeSession (or defaults), then overlay pythonState
  let sourceObj = activeSession || { profiles: { "Default": { ...DEFAULT_SETTINGS } }, current_profile: "Default" };
  let base = getSettingsResponse(sourceObj);
  // If pythonState is fresh, overlay its values (source of truth for engine state)
  if (pythonState && (Date.now() - pythonState.timestamp) < 10000) {
    const overwrite = (domKey, wireKey) => {
      if (pythonState[wireKey] !== undefined) { base[wireKey] = pythonState[wireKey]; base[domKey] = pythonState[wireKey]; }
    };
    overwrite('active-cb','active'); overwrite('body-cb','body_target'); overwrite('body-sl','custom_body_pct');
    overwrite('trig-cb','trigger_mode'); overwrite('virt-cb','virtual_ctrl_type');
    overwrite('ms-0-30','ms_0_30'); overwrite('ms-30-60','ms_30_60'); overwrite('ms-60-90','ms_60_90'); overwrite('ms-90p','ms_90p');
    overwrite('sm-damping','smooth_damping'); overwrite('deadzone','deadzone_px');
    overwrite('stick-limit','stick_limit'); overwrite('flick-power','flick_power'); overwrite('snap-mode','snap_mode');
    overwrite('model-cb','current_model_name'); overwrite('fov-cb','show_fov_overlay'); overwrite('fov-sl','fov_px'); overwrite('conf-sl','esp_conf');
    overwrite('fov_color','fov_color'); overwrite('fov_style','fov_style'); overwrite('fov_fill','fov_fill');
    if (pythonState.current_profile !== undefined) base.current_profile = pythonState.current_profile;
  }
  // Overlay any activeSession settings that differ from pythonState
  if (activeSession && pythonState) {
    const prof = activeSession.profiles[activeSession.current_profile || "Default"];
    if (prof) {
      const map = { active:'active', body_target:'body_target', custom_body_pct:'custom_body_pct', trigger_mode:'trigger_mode', virtual_ctrl_type:'virtual_ctrl_type', ms_0_30:'ms_0_30', ms_30_60:'ms_30_60', ms_60_90:'ms_60_90', ms_90p:'ms_90p', smooth_damping:'smooth_damping', deadzone_px:'deadzone_px', stick_limit:'stick_limit', flick_power:'flick_power', snap_mode:'snap_mode', current_model_name:'current_model_name', show_fov_overlay:'show_fov_overlay', fov_px:'fov_px', esp_conf:'esp_conf', fov_color:'fov_color', fov_style:'fov_style', fov_fill:'fov_fill' };
      for (const [k, v] of Object.entries(map)) {
        if (prof[k] !== undefined && prof[k] !== base[v]) base[v] = prof[k];
      }
      if (activeSession.current_profile) base.current_profile = activeSession.current_profile;
    }
  }
  base.ok = true;
  return res.json(base);
});

// POST Import settings
app.post('/api/settings/import', (req, res) => {
  if (!activeSession) {
    return res.json({ ok: false, message: 'Not logged in.' });
  }
  const importedData = mapIncomingSettings(req.body);
  if (Object.keys(importedData).length === 0) {
    return res.json({ ok: false, message: 'Invalid settings file.' });
  }
  const profileName = req.body.current_profile || "Imported_" + Math.floor(Math.random() * 1000);
  activeSession.profiles[profileName] = { ...DEFAULT_SETTINGS, ...importedData };
  activeSession.current_profile = profileName;
  return res.json({ ok: true });
});

app.get('/api/settings/folder', (req, res) => {
  return res.json({ ok: true, path: SETTINGS_DIR });
});

app.post('/api/status', (req, res) => {
  const { active, fps, running, target_locked } = req.body;
  realStatus = { active, fps, running, target_locked, timestamp: Date.now() };
  res.json({ ok: true });
});

app.get('/api/status', (req, res) => {
  const profileName = activeSession ? (activeSession.current_profile || "Default") : "Default";
  const p = activeSession ? (activeSession.profiles[profileName] || DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
  
  let fps = 0;
  if (realStatus && (Date.now() - realStatus.timestamp) < 5000) {
    fps = realStatus.fps || 0;
  }
  
  return res.json({ ok: true, active: p.active, fps: fps });
});
app.get('/api/profiles', (req, res) => {
  try {
    if (fs.existsSync(SETTINGS_DIR)) {
      const files = fs.readdirSync(SETTINGS_DIR).filter(f => f.endsWith('.json'));
      const profileNames = files.map(f => path.basename(f, '.json'));
      
      if (activeSession && activeSession.profiles) {
        const existingProfiles = {};
        for (const profileName of profileNames) {
          if (activeSession.profiles[profileName]) {
            existingProfiles[profileName] = activeSession.profiles[profileName];
          } else {
            const profileData = loadProfile(profileName);
            if (profileData) {
              existingProfiles[profileName] = profileData;
            }
          }
        }
        activeSession.profiles = existingProfiles;
        
        if (!profileNames.includes(activeSession.current_profile) && profileNames.length > 0) {
          activeSession.current_profile = profileNames[0];
        } else if (profileNames.length === 0) {
          activeSession.current_profile = 'Default';
        }
      }
      
      const currentProfile = activeSession ? (activeSession.current_profile || 'Default') : 'Default';
      let finalCurrent = currentProfile;
      if (!profileNames.includes(currentProfile) && profileNames.length > 0) {
        finalCurrent = profileNames[0];
        if (activeSession) activeSession.current_profile = finalCurrent;
      } else if (profileNames.length === 0) {
        finalCurrent = 'Default';
        if (activeSession) activeSession.current_profile = 'Default';
      }
      
      return res.json({
        ok: true,
        profiles: profileNames.length > 0 ? profileNames : ['Default'],
        current: finalCurrent
      });
    }
  } catch (e) {
    logToFile('Error loading profiles: ' + e.message);
  }
  return res.json({ ok: true, profiles: ['Default'], current: 'Default' });
});

app.get('/api/models', (req, res) => {
  if (pythonState && pythonState.available_models && (Date.now() - pythonState.timestamp) < 10000) {
    const current = pythonState.current_model_name || '';
    const display = current.includes('|') ? current.split('|')[1] : current;
    return res.json({ ok: true, models: pythonState.available_models, current: display });
  }
  const scanned = scanModels();
  return res.json({ ok: true, models: scanned.length ? scanned : ['Balance', 'Extreme', 'Performance'], current: '' });
});

app.post('/api/settings/save', (req, res) => {
  if (!activeSession) {
    return res.json({ ok: false, message: 'Not logged in.' });
  }
  
  // Sincronizar con disco antes de guardar (solo perfiles existentes)
  const currentProfiles = {};
  if (fs.existsSync(SETTINGS_DIR)) {
    const files = fs.readdirSync(SETTINGS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const profileName = path.basename(file, '.json');
      if (activeSession.profiles[profileName]) {
        currentProfiles[profileName] = activeSession.profiles[profileName];
      } else {
        const data = loadProfile(profileName);
        if (data) {
          currentProfiles[profileName] = data;
        }
      }
    }
  }
  activeSession.profiles = currentProfiles;
  
  // Guardar solo los perfiles que existen
  for (const profileName in activeSession.profiles) {
    saveProfile(profileName, activeSession.profiles[profileName]);
  }
  return res.json({ ok: true });
});

app.get('/api/shutdown', (req, res) => {
  logToFile('Shutdown endpoint called');
  const saved = checkAuth();
  logToFile('Saved auth: ' + JSON.stringify(saved));
  if (saved && saved.username) {
    logToFile('Setting log to Inactive for: ' + saved.username);
    setLogVercel(saved.username, 'Inactive');
    logToFile('setLogVercel called');
  } else {
    logToFile('No saved user found');
  }
  res.json({ ok: true });
});

app.post('/api/open-folder', (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) {
    return res.status(400).json({ ok: false, message: 'No path provided' });
  }
  
  try {
    const { exec } = require('child_process');
    exec(`explorer.exe "${folderPath}"`, (error) => {
      if (error) {
        return res.status(500).json({ ok: false, message: 'Failed to open folder' });
      }
      res.json({ ok: true });
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: 'Error: ' + e.message });
  }
});

const { watch } = require('fs');

let profileWatcher = null;
let sseClients = [];

function startProfileWatcher() {
  if (profileWatcher) return;
  
  try {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    
    profileWatcher = watch(SETTINGS_DIR, { persistent: false }, (eventType, filename) => {
      if (filename && filename.endsWith('.json')) {
        const data = JSON.stringify({ type: 'profiles-updated', timestamp: Date.now() });
        sseClients.forEach(client => {
          try {
            client.write(`data: ${data}\n\n`);
          } catch (e) {}
        });
      }
    });
    
    profileWatcher.on('error', (err) => {
      console.error('Watcher error:', err);
    });
    
    console.log('Profile watcher started');
  } catch (e) {
    console.error('Error starting profile watcher:', e);
  }
}

app.get('/api/profiles/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const newClient = res;
  sseClients.push(newClient);
  
  newClient.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  
  startProfileWatcher();

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== newClient);
  });
});

app.use(express.static(__dirname));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
