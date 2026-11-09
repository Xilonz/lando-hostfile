# Lando Hostfile Plugin

[![Lando API 3](https://img.shields.io/badge/lando-v3.x-blue.svg)](https://lando.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Automatically manages local hosts file entries for your [Lando](https://lando.dev) apps on `lando start` and cleans them up on `lando destroy`.

---

## Why do I need this?

By default, Lando routes local apps through `*.lndo.site` domains via public DNS servers that resolve back to `127.0.0.1`. In practice, this often causes issues:

1. **DNS Rebind Protection**: Modern routers (Fritz!Box, ASUS, pfSense, Ubiquiti, OpenWrt) and corporate networks actively block public DNS queries resolving to loopback (`127.0.0.1`) addresses to protect against DNS rebinding attacks.
2. **Offline Development**: When you're on a train, plane, or without an internet connection, public DNS queries for `.lndo.site` fail completely.
3. **Custom Local Domains**: When you configure custom domains in `.lando.yml` (e.g., `clientname.local`, `app.test`), you otherwise have to edit your hosts file manually.
4. **WSL2 Friction**: When running Lando inside WSL2, you usually browse your apps using Windows browsers (Chrome, Edge, Firefox). Editing `/etc/hosts` inside WSL doesn't help your Windows browser resolve the domains.

**This plugin eliminates all of that.** When an app boots with `lando start`, it registers all app and proxy domains in your hosts file. When you run `lando destroy`, it cleanly removes them.

---

## Key Features

- **Automated Lifecycle**: Injects entries on `lando start` and cleans up on `lando destroy`.
- **Zero Friction on WSL2**: Automatically updates the **Windows** hosts file directly from inside WSL2. Because WSL2 delegates DNS resolution to the Windows host, both your Windows desktop browser and your WSL terminal resolve your sites immediately.
- **Idempotent & Fast**: Checks file content before writing. If your domains are already present and up to date, it skips writing entirely and never triggers an elevation prompt.
- **Safe & Non-Destructive**:
  - Uses clearly marked comment blocks (`# START lando-hostfile: <app>` ... `# END lando-hostfile: <app>`).
  - Does not touch or corrupt any existing manual entries.
  - Automatically detects and preserves Windows CRLF (`\r\n`) vs Unix LF (`\n`) line endings.
  - Writes atomically to a temp file before elevated copying to prevent half-written files.
- **Error Resilient**: If hosts write permissions fail or UAC is cancelled, it prints a clean warning and lets Lando continue booting rather than crashing the process.

---

## How It Works

When your app starts, the plugin generates a targeted block in your hosts file:

```hosts
# START lando-hostfile: myapp
127.0.0.1 myapp.lndo.site admin.myapp.lndo.site mailhog.myapp.lndo.site
::1 myapp.lndo.site admin.myapp.lndo.site mailhog.myapp.lndo.site
# END lando-hostfile: myapp
```

On `lando destroy`, the block for that specific app is completely removed, leaving everything else untouched.

---

## Requirements

### Windows / WSL2
Writing to the Windows hosts file (`C:\Windows\System32\drivers\etc\hosts`) requires administrator elevation. The plugin automatically detects and uses the best available elevator:

1. **Windows 11 (24H2+)**: Native `sudo.exe`.
   - Enable it in **Settings > System > For developers > Enable sudo**, or via elevated PowerShell:
     ```powershell
     sudo config --enable normal
     ```
2. **Other Windows versions / Fallback**: [gsudo](https://github.com/gerardog/gsudo).
   - Install via Winget:
     ```powershell
     winget install gerardog.gsudo
     ```

### macOS / Linux
Writing to `/etc/hosts` (or `/private/etc/hosts` on macOS) requires `sudo`. 

> **Tip (Passwordless Sudo)**: To avoid typing your password every time a new app is started, you can add a sudoers rule for editing the hosts file:
> ```sudoers
> # Run visudo and add (replace 'username' with your username):
> username ALL=(ALL) NOPASSWD: /bin/cp /tmp/lando-hosts-* /etc/hosts
> ```

---

## Installation

### Via Lando CLI (Recommended)

Install directly from npm via Lando's plugin manager:

```bash
lando plugin-add @xilonz/lando-hostfile
```

### Manual / Git Installation

Clone the repository directly into your Lando plugins directory:

```bash
mkdir -p ~/.lando/plugins
git clone https://github.com/Xilonz/lando-hostfile.git ~/.lando/plugins/lando-hostfile
```

Or if you have the repo cloned locally in a projects directory, create a symlink:

```bash
ln -s ~/projects/lando-hostfile ~/.lando/plugins/lando-hostfile
```

### Verification

Verify that Lando recognizes the plugin:

```bash
lando config | grep -i hostfile
```

---

## Configuration (`.lando.yml`)

The plugin works out of the box with zero configuration. If needed, you can customize behavior per project in `.lando.yml`:

### Disable for a specific project
```yaml
name: myapp
recipe: wordpress

hostfile: false
```
or:
```yaml
hostfile:
  disabled: true
```

### Custom target IP
If you are binding your Lando proxy to a specific local interface (e.g. `127.0.0.2`):
```yaml
hostfile:
  ip: 127.0.0.2
```

### Disable IPv6 (`::1`)
By default both IPv4 (`127.0.0.1`) and IPv6 (`::1`) entries are generated. To disable IPv6:
```yaml
hostfile:
  ipv6: false
```

### WSL2: Also update Linux `/etc/hosts`
On WSL2, updating the Windows hosts file is usually sufficient because WSL2 resolves through Windows DNS. If you have custom networking where WSL2 doesn't use the Windows host resolver, enable Linux hosts sync:
```yaml
hostfile:
  updateWslHosts: true
```

---

## Testing

The plugin includes zero-dependency unit tests running on Node's native test runner:

```bash
npm test
```

---

## License

MIT © [Arjan Steenbergen](https://github.com/Xilonz)
