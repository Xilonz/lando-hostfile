'use strict';

const fs = require('fs');
const _ = require('lodash');

module.exports = (app, lando) => {
    app.events.on('post-init', () => {

        // Find al hostnames from app
        const urls = [...new Set(_.flatten(app.info.map((service) => {
            return service?.urls?.map((url) => {
                const urlObj = new URL(url);
                return urlObj.hostname;
            });
        })).filter((url) => {
            return url !== 'localhost';
        }))];

        // Build host file entries
        const hosts = urls.reduce((acc, url) => {
            return `${acc}127.0.0.1 ${url}\n::1 ${url}\n`;
        }, '').trim();

        const spawnSync = require("child_process").spawnSync;
        const spawn = require("child_process").spawn;

        // Get the contents of /etc/hosts
        const catHostProcess = spawnSync('sudo', ['cat', '/etc/hosts']);
        const hostsFile = catHostProcess.stdout.toString();

        // Have we done this before?
        const hasLandoManaged = hostsFile.includes(`#lando-managed-${app.name}`);

        // Lets add or replace the old entries
        const newHostsFile = hasLandoManaged ? hostsFile.replace(
            new RegExp(`#lando-managed-${app.name}[\s\S]*#end-lando-managed-${app.name}`, 'g'),
            `#lando-managed-${app.name}\n${hosts}\n#end-lando-managed-${app.name}`
        ) : `${hostsFile}\n#lando-managed-${app.name}\n${hosts}\n#end-lando-managed-${app.name}`;

        // Write the new hosts file
        spawn('sudo', ['sh', '-c', `echo "${newHostsFile}" > /etc/hosts`]);

        // WSL Stuff
        // Check for the WSL_DISTRO_NAME env variable to determine if we are running in WSL
        if (process.env.WSL_DISTRO_NAME) {
            // Find Windows
            const windirProcess = spawnSync('powershell.exe', ['-command', 'echo $env:WinDir']);
            const windir = windirProcess.stdout.toString().trim();

            // Get the WSL path of Windows
            const winwsldirProcess = spawnSync('wslpath', ['-u', windir]);
            const winwsldir = winwsldirProcess.stdout.toString().trim();

            // Not so DRY.. lets repeat everything from above
            const hostsFileWin = fs.readFileSync(winwsldir + '/System32/drivers/etc/hosts', 'utf8');
            const hasLandoManagedWin = hostsFileWin.includes(`#lando-managed-${app.name}`);
            const newWinHostsFile = hasLandoManagedWin ? hostsFileWin.replace(
                new RegExp(`#lando-managed-${app.name}[\s\S]*#end-lando-managed-${app.name}`, 'g'),
                `#lando-managed-${app.name}\n${hosts}\n#end-lando-managed-${app.name}`
            ) : `${hostsFileWin}\n#lando-managed-${app.name}\n${hosts}\n#end-lando-managed-${app.name}`;


            // Write to the host file 
            // Unfortunatly this might get blocked by your antivirus.
            // Soon we'll be able to utilize sudo for windows to maybe get around this?
            // Any help is appreciated

            // Create a ps1 file to write the new hosts file
            fs.writeFileSync(winwsldir + '/Temp/write-hosts.ps1', String.raw`echo "${newWinHostsFile}" > ${windir}\System32\drivers\etc\hosts`);

            // Execute the generated ps1.
            spawnSync('powershell.exe', ['Start-Process', '-Verb', 'RunAs', '-FilePath', String.raw`powershell.exe ${windir}\Temp\write-hosts.ps1`]);
        }
    });
};