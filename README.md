# Lando Hostfile Plugin

Automatically manages local hosts file entries for Lando apps on `lando start` and `lando destroy`.

Solves DNS re-binding protection, loopback restrictions by ISPs or routers, and custom local domain routing.

---

## Features

- **Automatic management**: Adds entries on `lando start`, cleanly removes them on `lando destroy`.
- **Idempotent**: Checks existing content first; only writes and requests elevation when entries actually changed.
- **Cross-platform**:
  - **macOS**: Updates `/private/etc/hosts`.
  - **Linux**: Updates `/etc/hosts`.
  - **Windows**: Updates `C:\Windows\System32\drivers\etc\hosts` via native Windows 11 `sudo.exe` or `gsudo`.
  - **WSL2**: Automatically updates the Windows host file so Windows browsers (and WSL via Windows DNS) resolve local sites immediately.
- **Safe & clean**:
  - Atomic temporary file copy rather than raw shell pipes.
  - Non-greedy regex matching with metacharacter escaping to protect existing hostfile entries.
  - Respects file line endings (`\r\n` vs `\n`).

---

## Requirements

### Windows / WSL2
For privilege elevation on Windows:
- **Windows 11 (24H2+)**: Native `sudo.exe` (Enable in *Settings > System > For developers > Enable sudo*).
- **Other Windows versions**: Install [gsudo](https://github.com/gerardog/gsudo) via `winget install gerardog.gsudo`.

### macOS / Linux
- `sudo` access to update `/etc/hosts`.

---

## Configuration

By default, the plugin automatically detects all service URLs for your app. You can customize behavior in `.lando.yml`:

### Disable for a specific project
```yaml
hostfile: false
```
or:
```yaml
hostfile:
  disabled: true
```

### Custom IP or disable IPv6
```yaml
hostfile:
  ip: 127.0.0.1      # Custom target IP (default: 127.0.0.1)
  ipv6: false        # Set to false to omit ::1 entries (default: true)
```

### WSL2: Update Linux `/etc/hosts` in addition to Windows
By default on WSL2, only the Windows hosts file is updated because WSL2 automatically resolves via the Windows DNS client. If you also want `/etc/hosts` updated inside WSL:
```yaml
hostfile:
  updateWslHosts: true
```

---

## Installation

### Local plugin directory
Clone or symlink into your user Lando plugins directory:
```bash
ln -s ~/projects/lando-hostfile ~/.lando/plugins/lando-hostfile
```

---

## License

MIT
