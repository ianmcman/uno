const test = require('node:test');
const assert = require('node:assert/strict');
const { limitKey } = require('../server/server.js');

test('IPv6 clients share a /64 key, IPv4 is unchanged', () => {
  assert.equal(limitKey('203.0.113.9'), '203.0.113.9');
  assert.equal(limitKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(limitKey('2001:db8:1:2:1::9'), '2001:db8:1:2::/64');
  assert.equal(limitKey('2001:db8::1'), '2001:db8:0:0::/64');
});
