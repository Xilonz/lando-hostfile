'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const OSC = '\u001B]';
const SEP = ';';
const BEL = '\u0007';
const terminallink = (text, url) =>
  [OSC, '8', SEP, SEP, url, BEL, text, OSC, '8', SEP, SEP, BEL].join('');

// Cached WSL Windows Directory Information
let cachedWindowsDirs = null;
let cachedElevator = null;

/**
 * Escapes a string for safe use in RegExp.
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if the current environment is running inside WSL.
 */
function isWslEnvironment(lando) {
  return Boolean(
    process.env.WSL_DISTRO_NAME ||
    process.env.WSL_INTEROP ||
    lando?.config?.os?.wsl ||
    lando?.config?.wsl
  );
}

/**
 * Transforms hosts file contents to add or update Lando managed entries for an app.
 */
function transformHostFile(contents, urls, identifier, options = {}) {
  const eol = contents.includes('\r\n') ? '\r\n' : '\n';
  const ip = options.ip || '127.0.0.1';
  const includeIpv6 = options.ipv6 !== false;

  const startMarker = `#lando-managed-${identifier}`;
  const endMarker = `#end-lando-managed-${identifier}`;

  if (!urls || urls.length === 0) {
    return removeAppFromHostFile(contents, identifier);
  }

  const hostLines = urls.flatMap(url => {
    const lines = [`${ip} ${url}`];
    if (includeIpv6) {
      lines.push(`::1 ${url}`);
    }
    return lines;
  });

  const block = [
    startMarker,
    ...hostLines,
    endMarker,
  ].join(eol);

  if (contents.includes(startMarker)) {
    const regex = new RegExp(`[\\t ]*${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}[\\t ]*`, 'g');
    return contents.replace(regex, block);
  }

  const separator = contents.length > 0 && !contents.endsWith(eol) ? eol : '';
  return `${contents}${separator}${block}${eol}`;
}

/**
 * Removes Lando managed entries for an app from hosts file contents.
 */
function removeAppFromHostFile(contents, identifier) {
  const eol = contents.includes('\r\n') ? '\r\n' : '\n';
  const startMarker = `#lando-managed-${identifier}`;
  const endMarker = `#end-lando-managed-${identifier}`;

  if (!contents.includes(startMarker)) {
    return contents;
  }

  const regex = new RegExp(`(?:\\r?\\n)?[\\t ]*${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}[\\t ]*(?:\\r?\\n)?`, 'g');
  const cleaned = contents.replace(regex, eol);
  const normalized = cleaned.replace(new RegExp(`(?:${eol}){3,}`, 'g'), `${eol}${eol}`);
  return normalized.trim() ? normalized.trim() + eol : '';
}

/**
 * Safely extracts hostnames from Lando app metadata.
 */
function getAppUrls(app, _) {
  const serviceUrls = Array.isArray(app?.info)
    ? _.flatten(app.info.map(service => service?.urls || []))
    : [];
  const directUrls = Array.isArray(app?.urls) ? app.urls : [];
  const allUrls = [...serviceUrls, ...directUrls];

  const hostnames = new Set();
  for (const rawUrl of allUrls) {
    if (!rawUrl || typeof rawUrl !== 'string') continue;
    try {
      const parsed = new URL(rawUrl.includes('://') ? rawUrl : `http://${rawUrl}`);
      const hostname = parsed.hostname.toLowerCase().trim();
      if (
        hostname &&
        hostname !== 'localhost' &&
        hostname !== '127.0.0.1' &&
        hostname !== '::1' &&
        hostname !== '0.0.0.0' &&
        !hostname.endsWith('.internal')
      ) {
        hostnames.add(hostname);
      }
    } catch {
      // Ignore malformed URLs
    }
  }

  return Array.from(hostnames);
}

/**
 * Resolves Windows directories when running in WSL.
 */
function getWindowsDirs() {
  if (cachedWindowsDirs) {
    return cachedWindowsDirs;
  }

  try {
    const winDirProc = spawnSync('cmd.exe', ['/c', 'echo %SystemRoot%'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const winDir = (winDirProc.stdout && winDirProc.stdout.trim()) || 'C:\\Windows';

    const winTmpProc = spawnSync('cmd.exe', ['/c', 'echo %TEMP%'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const winTmpDir = (winTmpProc.stdout && winTmpProc.stdout.trim()) || `${winDir}\\Temp`;

    const winWslDirProc = spawnSync('wslpath', ['-u', winDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const winWslDir = (winWslDirProc.stdout && winWslDirProc.stdout.trim()) || '/mnt/c/Windows';

    const winWslTmpProc = spawnSync('wslpath', ['-u', winTmpDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const winWslTmpDir = (winWslTmpProc.stdout && winWslTmpProc.stdout.trim()) || `${winWslDir}/Temp`;

    cachedWindowsDirs = { winDir, winWslDir, winTmpDir, winWslTmpDir };
    return cachedWindowsDirs;
  } catch {
    cachedWindowsDirs = {
      winDir: 'C:\\Windows',
      winWslDir: '/mnt/c/Windows',
      winTmpDir: 'C:\\Windows\\Temp',
      winWslTmpDir: '/mnt/c/Windows/Temp',
    };
    return cachedWindowsDirs;
  }
}

/**
 * Detects whether Windows sudo.exe or gsudo is available.
 */
function getWindowsElevator(isWsl = false) {
  if (cachedElevator !== null) {
    return cachedElevator;
  }

  const stdinRedirect = isWsl ? ' < /dev/null' : '';

  // 1. Try Windows 11 native sudo.exe
  try {
    const check = execSync(`sudo.exe config${stdinRedirect}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    if (!check.toLowerCase().includes('disabled')) {
      cachedElevator = 'sudo';
      return cachedElevator;
    }
  } catch {}

  // 2. Try gsudo
  try {
    execSync(`gsudo.exe --version${stdinRedirect}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    cachedElevator = 'gsudo';
    return cachedElevator;
  } catch {}

  cachedElevator = false;
  return null;
}

/**
 * Returns a list of host file targets for the current system.
 */
function getHostFiles(lando) {
  const hostFiles = [];
  const isWsl = isWslEnvironment(lando);

  if (isWsl) {
    // 1. Windows hosts file (primary on WSL for Windows browser resolution and WSL DNS query)
    const { winDir, winWslDir } = getWindowsDirs();
    const winHostsWslPath = path.posix.join(winWslDir, 'System32/drivers/etc/hosts');
    const winHostsWinPath = `${winDir}\\System32\\drivers\\etc\\hosts`;

    try {
      if (fs.existsSync(winHostsWslPath)) {
        hostFiles.push({
          path: winHostsWinPath,
          readPath: winHostsWslPath,
          contents: fs.readFileSync(winHostsWslPath, 'utf8'),
          platform: 'wsl',
        });
      }
    } catch (err) {
      lando?.log?.warn(`[hostfile] Could not read Windows hosts file at ${winHostsWslPath}: ${err.message}`);
    }

    // 2. Linux /etc/hosts inside WSL (only if explicitly enabled via config)
    const updateLinuxHostsInWsl = Boolean(lando?.config?.hostfile?.updateWslHosts);
    if (updateLinuxHostsInWsl) {
      try {
        if (fs.existsSync('/etc/hosts')) {
          hostFiles.push({
            path: '/etc/hosts',
            readPath: '/etc/hosts',
            contents: fs.readFileSync('/etc/hosts', 'utf8'),
            platform: 'linux',
          });
        }
      } catch (err) {
        lando?.log?.warn(`[hostfile] Could not read Linux /etc/hosts: ${err.message}`);
      }
    }
  } else if (process.platform === 'win32') {
    const winDir = process.env.SystemRoot || process.env.WinDir || 'C:\\Windows';
    const winHostsPath = path.join(winDir, 'System32', 'drivers', 'etc', 'hosts');
    try {
      if (fs.existsSync(winHostsPath)) {
        hostFiles.push({
          path: winHostsPath,
          readPath: winHostsPath,
          contents: fs.readFileSync(winHostsPath, 'utf8'),
          platform: 'win32',
        });
      }
    } catch (err) {
      lando?.log?.warn(`[hostfile] Could not read hosts file at ${winHostsPath}: ${err.message}`);
    }
  } else {
    // macOS ('darwin') or Native Linux ('linux')
    const nixPath = process.platform === 'darwin' ? '/private/etc/hosts' : '/etc/hosts';
    try {
      if (fs.existsSync(nixPath)) {
        let contents = '';
        try {
          contents = fs.readFileSync(nixPath, 'utf8');
        } catch {
          const res = spawnSync('sudo', ['cat', nixPath], { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' });
          contents = res.stdout || '';
        }
        hostFiles.push({
          path: nixPath,
          readPath: nixPath,
          contents,
          platform: process.platform,
        });
      }
    } catch (err) {
      lando?.log?.warn(`[hostfile] Could not read hosts file at ${nixPath}: ${err.message}`);
    }
  }

  return hostFiles;
}

/**
 * Writes updated contents to the specified hosts file using elevated privileges.
 */
function writeHostFile(lando, fileInfo, contents) {
  const { path: targetPath, platform } = fileInfo;

  switch (platform) {
    case 'darwin':
    case 'linux': {
      const tmpPath = `/tmp/lando_hosts_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.tmp`;
      try {
        fs.writeFileSync(tmpPath, contents, 'utf8');
        execSync(`sudo cp "${tmpPath}" "${targetPath}"`, { stdio: 'inherit' });
      } finally {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      }
      break;
    }

    case 'wsl': {
      const elevator = getWindowsElevator(true);
      if (!elevator) {
        lando?.log?.warn(
          'Sudo for Windows (sudo.exe or gsudo) not found or disabled. Unable to update Windows hosts file. ' +
          'Please enable Sudo in ' +
          terminallink('Developer Settings', 'ms-settings:developers') +
          ' or install gsudo.'
        );
        return false;
      }

      const { winTmpDir, winWslTmpDir } = getWindowsDirs();
      const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const tmpWslPath = `${winWslTmpDir}/lando_hosts_${uniqueSuffix}.tmp`;
      const tmpWinPath = `${winTmpDir}\\lando_hosts_${uniqueSuffix}.tmp`;

      try {
        fs.writeFileSync(tmpWslPath, contents, 'utf8');
        const copyCmd = `cmd.exe /c "copy /y \\"${tmpWinPath}\\" \\"${targetPath}\\"" < /dev/null`;
        const elevationPrefix = elevator === 'sudo' ? 'sudo.exe' : 'gsudo.exe';
        execSync(`${elevationPrefix} ${copyCmd}`, {
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
        });
      } finally {
        if (fs.existsSync(tmpWslPath)) {
          fs.unlinkSync(tmpWslPath);
        }
      }
      break;
    }

    case 'win32': {
      const elevator = getWindowsElevator(false);
      if (!elevator) {
        lando?.log?.warn(
          'Sudo for Windows (sudo.exe or gsudo) not found or disabled. Unable to update hosts file. ' +
          'Please enable Sudo in ' +
          terminallink('Developer Settings', 'ms-settings:developers') +
          ' or install gsudo.'
        );
        return false;
      }

      const tmpDir = process.env.TEMP || process.env.TMP || 'C:\\Windows\\Temp';
      const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const tmpPath = path.join(tmpDir, `lando_hosts_${uniqueSuffix}.tmp`);

      try {
        fs.writeFileSync(tmpPath, contents, 'utf8');
        const copyCmd = `cmd.exe /c copy /y "${tmpPath}" "${targetPath}"`;
        const elevationPrefix = elevator === 'sudo' ? 'sudo.exe' : 'gsudo.exe';
        execSync(`${elevationPrefix} ${copyCmd}`, {
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf-8',
        });
      } finally {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      }
      break;
    }
  }

  return true;
}

/**
 * Lando App Event Registration
 */
module.exports = (app, lando) => {
  const _ = (lando?.utils && lando?.utils?.getLodash) ? lando.utils.getLodash() : require('lodash');

  const isEnabled = () => {
    const config = app?.config?.hostfile;
    if (config === false || (typeof config === 'object' && config?.disabled === true)) {
      return false;
    }
    return true;
  };

  const getOptions = () => {
    const config = app?.config?.hostfile || {};
    return {
      ip: config.ip || '127.0.0.1',
      ipv6: config.ipv6 !== false,
    };
  };

  // 1. post-start: add or update entries
  app.events.on('post-start', () => {
    if (!isEnabled()) {
      lando?.log?.debug(`[hostfile] Disabled for ${app.project}`);
      return;
    }

    const urls = getAppUrls(app, _);
    if (urls.length === 0) {
      return;
    }

    const hostsFiles = getHostFiles(lando);
    const options = getOptions();

    hostsFiles.forEach(file => {
      try {
        const newContents = transformHostFile(file.contents, urls, app.project, options);
        if (file.contents !== newContents) {
          lando?.log?.info(`[hostfile] Updating hosts entries for ${app.project}...`);
          const success = writeHostFile(lando, file, newContents);
          if (success) {
            lando?.log?.info(`[hostfile] Successfully updated ${file.path}`);
          }
        }
      } catch (err) {
        lando?.log?.warn(`[hostfile] Failed to update ${file.path}: ${err.message}`);
      }
    });
  });

  // 2. post-destroy: clean up entries
  app.events.on('post-destroy', () => {
    if (!isEnabled()) {
      return;
    }

    const hostsFiles = getHostFiles(lando);
    hostsFiles.forEach(file => {
      try {
        const newContents = removeAppFromHostFile(file.contents, app.project);
        if (file.contents !== newContents) {
          lando?.log?.info(`[hostfile] Removing hosts entries for ${app.project}...`);
          const success = writeHostFile(lando, file, newContents);
          if (success) {
            lando?.log?.info(`[hostfile] Successfully removed entries from ${file.path}`);
          }
        }
      } catch (err) {
        lando?.log?.warn(`[hostfile] Failed to remove entries from ${file.path}: ${err.message}`);
      }
    });
  });

  return {};
};

// Export helper functions for testing
module.exports.escapeRegExp = escapeRegExp;
module.exports.transformHostFile = transformHostFile;
module.exports.removeAppFromHostFile = removeAppFromHostFile;
module.exports.getAppUrls = getAppUrls;
module.exports.getHostFiles = getHostFiles;
module.exports.writeHostFile = writeHostFile;
module.exports.getWindowsDirs = getWindowsDirs;
module.exports.getWindowsElevator = getWindowsElevator;
module.exports.isWslEnvironment = isWslEnvironment;
