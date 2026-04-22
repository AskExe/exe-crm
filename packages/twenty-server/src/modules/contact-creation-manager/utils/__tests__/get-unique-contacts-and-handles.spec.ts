import { type Contact } from 'src/modules/contact-creation-manager/types/contact.type';
import { getUniqueContactsAndHandles } from 'src/modules/contact-creation-manager/utils/get-unique-contacts-and-handles.util';

describe('getUniqueContactsAndHandles', () => {
  it('should return empty arrays when contacts is empty', () => {
    const contacts: Contact[] = [];
    const result = getUniqueContactsAndHandles(contacts);

    expect(result.uniqueContacts).toEqual([]);
    expect(result.uniqueHandles).toEqual([]);
  });

  it('should return unique contacts and handles', () => {
    const contacts: Contact[] = [
      { handle: 'john@askexe.com', displayName: 'John Doe' },
      { handle: 'john@askexe.com', displayName: 'John Doe' },
      { handle: 'jane@askexe.com', displayName: 'Jane Smith' },
      { handle: 'jane@askexe.com', displayName: 'Jane Smith' },
      { handle: 'jane@askexe.com', displayName: 'Jane Smith' },
    ];
    const result = getUniqueContactsAndHandles(contacts);

    expect(result.uniqueContacts).toEqual([
      { handle: 'john@askexe.com', displayName: 'John Doe' },
      { handle: 'jane@askexe.com', displayName: 'Jane Smith' },
    ]);
    expect(result.uniqueHandles).toEqual([
      'john@askexe.com',
      'jane@askexe.com',
    ]);
  });

  it('should deduplicate handles when they are in different cases', () => {
    const contacts: Contact[] = [
      { handle: 'john@askexe.com', displayName: 'John Doe' },
      { handle: 'John@askexe.com', displayName: 'John Doe' },
    ];
    const result = getUniqueContactsAndHandles(contacts);

    expect(result.uniqueContacts).toEqual([
      { handle: 'john@askexe.com', displayName: 'John Doe' },
    ]);
    expect(result.uniqueHandles).toEqual(['john@askexe.com']);
  });
});
