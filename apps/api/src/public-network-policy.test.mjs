import { expect, test } from 'bun:test';
import { isPublicAddress } from './public-network-policy';
import { createPublicLookup, nodePublicFetch } from './node-public-network';

test('non-public and mapped addresses are refused', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '2001:db8::1']) expect(isPublicAddress(address)).toBe(false);
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) expect(isPublicAddress(address)).toBe(true);
});
test('TLS lookup uses the validated answer directly and rejects mixed public/private DNS results', async () => {
  const run = async addresses => new Promise(resolve => {
    const lookup = createPublicLookup((_hostname, _options, callback) => callback(null, addresses));
    lookup('example.org', { all: true }, (error, result) => resolve({ error, result }));
  });
  const valid = [{ address: '1.1.1.1', family: 4 }]; expect((await run(valid)).result).toEqual(valid);
  expect((await run([...valid, { address: '127.0.0.1', family: 4 }])).error).toBeInstanceOf(Error);
});
test('self-hosted transport rejects local targets and cancelled calls before opening a connection', async () => {
  await expect(nodePublicFetch('https://localhost')).rejects.toThrow();
  const controller = new AbortController(); controller.abort();
  await expect(nodePublicFetch('https://example.org', { signal: controller.signal })).rejects.toThrow();
});
