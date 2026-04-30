import { isEmailBlocklisted } from 'src/modules/blocklist/utils/is-email-blocklisted.util';

describe('isEmailBlocklisted', () => {
  it('should return true if email is blocklisted', () => {
    const channelHandles = ['abc@example.com'];
    const email = 'hello@askexe.com';
    const blocklist = ['hello@askexe.com', 'hey@askexe.com'];
    const result = isEmailBlocklisted(channelHandles, email, blocklist);

    expect(result).toBe(true);
  });
  it('should return false if email is not blocklisted', () => {
    const channelHandles = ['abc@example.com'];
    const email = 'hello@askexe.com';
    const blocklist = ['hey@example.com'];
    const result = isEmailBlocklisted(channelHandles, email, blocklist);

    expect(result).toBe(false);
  });
  it('should return false if email is null', () => {
    const channelHandles = ['abc@askexe.com'];
    const email = null;
    const blocklist = ['@example.com'];
    const result = isEmailBlocklisted(channelHandles, email, blocklist);

    expect(result).toBe(false);
  });
  it('should return true for subdomains', () => {
    const channelHandles = ['abc@example.com'];
    const email = 'hello@twenty.askexe.com';
    const blocklist = ['@askexe.com'];
    const result = isEmailBlocklisted(channelHandles, email, blocklist);

    expect(result).toBe(true);
  });
  it('should return false for domains which end with blocklisted domain but are not subdomains', () => {
    const channelHandles = ['abc@example.com'];
    const email = 'hello@twentyaskexe.com';
    const blocklist = ['@askexe.com'];
    const result = isEmailBlocklisted(channelHandles, email, blocklist);

    expect(result).toBe(false);
  });
  it('should return false if email is undefined', () => {
    const channelHandles = ['abc@example.com'];
    const email = undefined;
    const blocklist = ['@askexe.com'];
    const result = isEmailBlocklisted(channelHandles, email, blocklist);

    expect(result).toBe(false);
  });
  it('should return true if email ends with blocklisted domain', () => {
    const channelHandles = ['abc@example.com'];
    const email = 'hello@askexe.com';
    const blocklist = ['@askexe.com'];
    const result = isEmailBlocklisted(channelHandles, email, blocklist);

    expect(result).toBe(true);
  });

  it('should return false if email is same as channel handle', () => {
    const channelHandles = ['hello@askexe.com'];
    const email = 'hello@askexe.com';
    const blocklist = ['@askexe.com'];
    const result = isEmailBlocklisted(channelHandles, email, blocklist);

    expect(result).toBe(false);
  });
});
