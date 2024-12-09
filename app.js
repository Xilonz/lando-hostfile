'use strict';

const fs = require('fs');
const _ = require('lodash');
const { emit } = require('process');
const spawnSync = require("child_process").spawnSync;
const execSync = require("child_process").execSync;

const process = require('process');

const OSC = "\u001B]";
const SEP = ";";
const BEL = "\u0007";
const terminallink = (text, url) =>
  [OSC, "8", SEP, SEP, url, BEL, text, OSC, "8", SEP, SEP, BEL].join("");

function transformHostFile( contents, urls, identifier ){
  const startMarker = `#lando-managed-${ identifier }`
  const endMarker = `#end-lando-managed-${ identifier }`

  const hasLandoManaged = contents.includes( startMarker );

  const hosts = urls.reduce((acc, url) => {
    return `${acc}127.0.0.1 ${url}\n::1 ${url}\n`;
  }, '').trim(); 

  return hasLandoManaged ? contents.replace(
      new RegExp(`${ startMarker }[\s\S]*${ endMarker }`, 'g'),
      `${ startMarker }\n${hosts}\n${ endMarker }`
  ) : `${contents}\n${ startMarker }\n${hosts}\n${ endMarker }`;
}

function getHostFilePath( platform = process.platform ){
  switch ( platform ) {
    case 'darwin':
      return '/private/etc/hosts'
    case 'linux':
      return '/etc/hosts'
    case 'win32':
      const winDir = process.env.WinDir
      return String.raw`${winDir}\System32\drivers\etc\hosts`
  }
}

function getHostFiles(){
  const hostFiles = [];

  switch (process.platform) {
    case 'darwin':
    case 'linux': 
      const nixDir = getHostFilePath( process.platform );
      const nixProcess = spawnSync('sudo', ['cat', nixDir ])
      hostFiles.push( {
        'path': nixDir,
        'contents': nixProcess.stdout.toString(),
        'platform': process.platform
      } )
      break;
    case 'win32':
      const winDir = getHostFilePath( process.platform );
      hostFiles.push( {
        'path': winDir,
        'contents': fs.readFileSync( winDir, 'utf8'),
        'platform': process.platform
      } )
      break;
  }

  // Check for the WSL_DISTRO_NAME env variable to determine if we are running within WSL
  if ( process.env.WSL_DISTRO_NAME ) {
    const winDirProcess = spawnSync('powershell.exe',  ['-command', 'echo $env:WinDir'])
    const winDir = winDirProcess.stdout.toString().trim()
    const winWslDirProcess = spawnSync('wslpath', ['-u', winDir ])
    const winWslDir = winWslDirProcess.stdout.toString().trim()

    const winHostsFile = fs.readFileSync( winWslDir + '/System32/drivers/etc/hosts', 'utf8')
    hostFiles.push( {
      'path': String.raw`${winDir}\System32\drivers\etc\hosts`,
      'contents': winHostsFile,
      'platform': 'wsl'
    } )
  }

  return hostFiles
}

function writeHostFile( path, contents, platform = process.platform ){
  switch ( platform ) {
    case 'darwin':
    case 'linux': 
      execSync(`echo '${contents}' | sudo tee ${path}`, { 
        shell: true,
        stdio: [
          'inherit',
          'inherit',
          'inherit' 
        ],
        encoding: 'utf-8'
      });
      break;

    case 'win32':
    case 'wsl':
      if( !has_sudo() ) {
        console.warn('Sudo.exe not found, unable to update hosts file. Please enable sudo in the ' + terminallink('Developer Settings page', 'ms-settings:developers') +' in the Settings app' );
        return;
      }

      const winTmpDirProcess = spawnSync('powershell.exe',  ['-command', 'echo $env:tmp'])
      const winTmpDir = String.raw`${ winTmpDirProcess.stdout.toString().trim() }`

      const winWslBatProcess = spawnSync('wslpath', ['-u', winTmpDir ])
      const winWslTmpDir = String.raw`${ winWslBatProcess.stdout.toString().trim() }`

      // Write the contents to a temporary file
      fs.writeFileSync( String.raw`${winWslTmpDir}/lando_hosts.tmp` , contents );

      spawnSync('sudo.exe',  [ 'cmd.exe', '/c',  String.raw`"type ${winTmpDir}\lando_hosts.tmp > ${path}"` ], {shell: true})
      break;
  }
}

function has_sudo(){
  // This will display a message as well?
  try {
    execSync( 'sudo.exe config', {
      stdio: [ 'ignore', 'ignore', 'ignore']
    });
  } catch ( e ) {
    // If exit code != 0, sudo.exe is disabled
    return false;
  }

  return true;
}

module.exports = (app, lando) => {
  app.events.on('post-start', () => {
    // Get all urls from app info
    const urls = [...new Set(_.flatten( app.info.map( ( service ) => {
        return service?.urls?.map( ( url ) => {
          const urlObj = new URL( url )
          return urlObj.hostname
        });
    } )).filter( ( url ) => {
      return url !== 'localhost'
    }))]

    if( urls.lenght === 0 ) {
      return
    }

    const hostsFiles = getHostFiles()

    // loop through all host files and update them
    hostsFiles.forEach(( {
      'path': hostFile,
      'contents': hostFileContents,
      'platform': platform
    } ) => {
      const newHostsFileContents = transformHostFile( hostFileContents, urls, app.project )

      if ( hostFileContents !== newHostsFileContents ) {
        writeHostFile( hostFile, newHostsFileContents, platform )
      }
    })
  });

  return {};
};