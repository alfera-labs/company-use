import { read_web_call_address } from '@runtime-platform/triggers/web_call_address';
import { describe, expect, it } from 'vitest';

const inside_name = 'http://api:3001';
const on_this_machine = 'http://localhost:3393';

describe('the address a web-call trigger is called at', () => {
  it('is the public address of a self-host that has one', () => {
    const address = read_web_call_address('trg_1', {
      api_public_url: 'https://alfera.example.com/',
      api_url: inside_name,
      api_url_on_this_machine: on_this_machine,
      self_hosted: true,
    });

    expect(address).toEqual({
      webhook_url: 'https://alfera.example.com/v1/triggers/deliveries/webhook/trg_1',
      reaches_outside_this_machine: true,
    });
  });

  it('is the address this machine can use on a self-host with no public address, never the inside name, and says so', () => {
    const address = read_web_call_address('trg_1', {
      api_public_url: undefined,
      api_url: inside_name,
      api_url_on_this_machine: on_this_machine,
      self_hosted: true,
    });

    expect(address).toEqual({
      webhook_url: 'http://localhost:3393/v1/triggers/deliveries/webhook/trg_1',
      reaches_outside_this_machine: false,
    });
    expect(address.webhook_url).not.toContain('api:3001');
  });

  it('is the API address on the hosted product, as before', () => {
    const address = read_web_call_address('trg_1', {
      api_public_url: undefined,
      api_url: 'https://api.example.com',
      api_url_on_this_machine: 'https://api.example.com',
      self_hosted: false,
    });

    expect(address).toEqual({
      webhook_url: 'https://api.example.com/v1/triggers/deliveries/webhook/trg_1',
      reaches_outside_this_machine: true,
    });
  });
});
