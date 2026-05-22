import { describe, expect, it } from 'vitest';

import { inspectWbLkStorageStateAuth } from './lk-refresh-flow';

describe('inspectWbLkStorageStateAuth', () => {
  it('detects modern WB LK refresh-flow inputs', () => {
    const storageState = JSON.stringify({
      cookies: [
        { name: 'wbx-refresh', value: 'refresh', domain: '.seller-auth.wildberries.ru' },
        { name: 'wbx-validation-key', value: 'validation', domain: '.wildberries.ru' },
      ],
      origins: [
        {
          origin: 'https://seller.wildberries.ru',
          localStorage: [
            { name: 'wb-eu-passport-v2.access-token', value: 'authorize-v3-token' },
            { name: '@root/latest-app-version', value: 'v1.91.1' },
          ],
        },
      ],
    });

    expect(inspectWbLkStorageStateAuth(storageState)).toEqual({
      hasAuthorizeV3: true,
      hasWbxRefresh: true,
      hasWbxValidationKey: true,
      hasLegacyWbToken: false,
      rootVersion: 'v1.91.1',
    });
  });

  it('keeps missing authorizev3 visible for source health', () => {
    const storageState = JSON.stringify({
      cookies: [
        { name: 'wbx-refresh', value: 'refresh' },
        { name: 'wbx-validation-key', value: 'validation' },
      ],
      origins: [{ origin: 'https://seller.wildberries.ru', localStorage: [] }],
    });

    expect(inspectWbLkStorageStateAuth(storageState)).toMatchObject({
      hasAuthorizeV3: false,
      hasWbxRefresh: true,
      hasWbxValidationKey: true,
    });
  });
});
