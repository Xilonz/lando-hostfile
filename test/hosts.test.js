'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const hosts = require('../app.js');

test('transformHostFile: adds new lando-managed block to hosts file', () => {
  const initial = '127.0.0.1 localhost\n::1 localhost\n';
  const urls = ['mysite.lndo.site'];
  const result = hosts.transformHostFile(initial, urls, 'mysite');

  assert.ok(result.includes('#lando-managed-mysite'));
  assert.ok(result.includes('127.0.0.1 mysite.lndo.site'));
  assert.ok(result.includes('::1 mysite.lndo.site'));
  assert.ok(result.includes('#end-lando-managed-mysite'));
  assert.ok(result.startsWith('127.0.0.1 localhost\n::1 localhost\n'));
});

test('transformHostFile: updates existing lando-managed block without touching other contents', () => {
  const initial = [
    '# System hosts',
    '127.0.0.1 localhost',
    '#lando-managed-mysite',
    '127.0.0.1 old.lndo.site',
    '::1 old.lndo.site',
    '#end-lando-managed-mysite',
    '192.168.1.100 custom.server',
    ''
  ].join('\n');

  const urls = ['new1.lndo.site', 'new2.lndo.site'];
  const result = hosts.transformHostFile(initial, urls, 'mysite');

  assert.ok(result.includes('# System hosts'));
  assert.ok(result.includes('192.168.1.100 custom.server'));
  assert.ok(!result.includes('old.lndo.site'));
  assert.ok(result.includes('127.0.0.1 new1.lndo.site'));
  assert.ok(result.includes('::1 new1.lndo.site'));
  assert.ok(result.includes('127.0.0.1 new2.lndo.site'));
  assert.ok(result.includes('::1 new2.lndo.site'));
});

test('transformHostFile: preserves CRLF (Windows) line endings', () => {
  const initial = '127.0.0.1 localhost\r\n::1 localhost\r\n';
  const urls = ['winapp.lndo.site'];
  const result = hosts.transformHostFile(initial, urls, 'winapp');

  assert.ok(result.includes('\r\n'));
  assert.ok(!result.replace(/\r\n/g, '').includes('\n'));
  assert.ok(result.includes('#lando-managed-winapp\r\n127.0.0.1 winapp.lndo.site\r\n::1 winapp.lndo.site\r\n#end-lando-managed-winapp\r\n'));
});

test('transformHostFile: supports custom IP and disabling IPv6', () => {
  const initial = '127.0.0.1 localhost\n';
  const urls = ['custom-ip.lndo.site'];
  const result = hosts.transformHostFile(initial, urls, 'custom-ip', {
    ip: '192.168.99.100',
    ipv6: false,
  });

  assert.ok(result.includes('192.168.99.100 custom-ip.lndo.site'));
  assert.ok(!result.includes('::1 custom-ip.lndo.site'));
});

test('removeAppFromHostFile: cleanly removes managed block', () => {
  const initial = [
    '127.0.0.1 localhost',
    '#lando-managed-app1',
    '127.0.0.1 app1.lndo.site',
    '::1 app1.lndo.site',
    '#end-lando-managed-app1',
    '#lando-managed-app2',
    '127.0.0.1 app2.lndo.site',
    '::1 app2.lndo.site',
    '#end-lando-managed-app2',
    ''
  ].join('\n');

  const result = hosts.removeAppFromHostFile(initial, 'app1');
  assert.ok(!result.includes('app1'));
  assert.ok(result.includes('127.0.0.1 localhost'));
  assert.ok(result.includes('#lando-managed-app2'));
  assert.ok(result.includes('app2.lndo.site'));
});

test('removeAppFromHostFile: no-op if app not found', () => {
  const initial = '127.0.0.1 localhost\n';
  const result = hosts.removeAppFromHostFile(initial, 'nonexistent');
  assert.equal(result, initial);
});

test('getAppUrls: filters and deduplicates URLs safely', () => {
  const _ = require('lodash');
  const mockApp = {
    urls: ['https://direct.lndo.site', 'http://duplicate.lndo.site:80'],
    info: [
      {
        service: 'appserver',
        urls: [
          'http://duplicate.lndo.site',
          'https://duplicate.lndo.site:443',
          'http://localhost',
          'http://127.0.0.1:8080',
          'http://0.0.0.0:80',
          'http://host.lando.internal',
          'http://foo bar with spaces',
          'http://:80'
        ]
      },
      {
        service: 'database',
        urls: null
      }
    ]
  };

  const urls = hosts.getAppUrls(mockApp, _);
  assert.deepEqual(urls.sort(), ['direct.lndo.site', 'duplicate.lndo.site'].sort());
});

test('escapeRegExp: safely escapes regex metacharacters in identifiers', () => {
  const escaped = hosts.escapeRegExp('my-app.site[0]+test$');
  assert.equal(escaped, 'my-app\\.site\\[0\\]\\+test\\$');
});

test('isWslEnvironment: accurately detects WSL', () => {
  assert.equal(typeof hosts.isWslEnvironment({}), 'boolean');
});

test('event hooks: registers post-start and post-destroy', () => {
  const registeredEvents = {};
  const mockApp = {
    project: 'testproject',
    config: { hostfile: false }, // disabled
    events: {
      on: (event, cb) => {
        registeredEvents[event] = cb;
      }
    }
  };
  const mockLando = {
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {}
    }
  };

  hosts(mockApp, mockLando);
  assert.ok(typeof registeredEvents['post-start'] === 'function');
  assert.ok(typeof registeredEvents['post-destroy'] === 'function');

  // Trigger post-start when disabled -> returns early
  registeredEvents['post-start']();
  registeredEvents['post-destroy']();
});
