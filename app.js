'use strict';

const fs = require('fs');
const _ = require('lodash');
const spawnSync = require("child_process").spawnSync;

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
    case 'win32':
      const winDir = getHostFilePath( process.platform );
      hostFiles.push( {
        'path': winDir,
        'contents': fs.readFileSync( winDir, 'utf8'),
        'platform': process.platform
      } )
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
      spawnSync('sudo', ['sh', '-c', String.raw`echo "${contents}" > ${path}`], {shell: true})
      return;

    case 'win32':
    case 'wsl':
      if( !has_sudo() ) {
        console.warn('No sudo found, unable to update hosts file. Please install https://github.com/gerardog/gsudo');
        return;
      }

      const winTmpDirProcess = spawnSync('powershell.exe',  ['-command', 'echo $env:tmp'])
      const winTmpDir = String.raw`${ winTmpDirProcess.stdout.toString().trim() }`

      const winWslBatProcess = spawnSync('wslpath', ['-u', winTmpDir ])
      const winWslTmpDir = String.raw`${ winWslBatProcess.stdout.toString().trim() }`

      // Write the contents to a temporary file
      fs.writeFileSync( String.raw`${winWslTmpDir}/lando_hosts.tmp` , contents );

      spawnSync('sudo.exe',  ['-d', String.raw`"type ${winTmpDir}\lando_hosts.tmp > ${path}"` ], {shell: true})
      return;
  }
}

function has_sudo(){
  const sudoProcess = spawnSync('sudo.exe', ['--version'], { shell: true });
  return sudoProcess.stderr.length === 0
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

      // Check if the host file is the same as the new one
      if ( hostFileContents !== newHostsFileContents ) {
        writeHostFile( hostFile, newHostsFileContents, platform )
      }
    })
  });

  return {};
};