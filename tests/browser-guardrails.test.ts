// Navegador integrado — what stops the agent without the owner watching. A hole here would not show up using the app.
import { describe, expect, it } from 'vitest';
import { refusedUploadFile, refusedUploadFolder } from '../src/shared/browser/upload';

describe('envio de arquivo', () => {
  const context = { home: 'C:\\Users\\dono', userData: 'C:\\Users\\dono\\AppData\\Roaming\\donel-dev' };

  it('a pasta autorizada nunca é a de credenciais nem a casa inteira', () => {
    expect(refusedUploadFolder('C:\\Users\\dono\\Documents\\envios', context)).toBeNull();
    expect(refusedUploadFolder('C:\\', context)).not.toBeNull();
    expect(refusedUploadFolder('C:\\Users\\dono', context)).not.toBeNull();
    expect(refusedUploadFolder('C:\\Users', context)).not.toBeNull();
    expect(refusedUploadFolder('c:\\users\\dono\\.CLAUDE', context)).not.toBeNull();
    expect(refusedUploadFolder('C:\\Users\\dono\\.ssh\\chaves', context)).not.toBeNull();
    expect(refusedUploadFolder('C:\\Users\\dono\\AppData\\Roaming\\donel-dev', context)).not.toBeNull();
  });

  it('só sai arquivo comum de dentro da pasta', () => {
    expect(refusedUploadFile('contrato.pdf')).toBeNull();
    expect(refusedUploadFile('notas\\2026\\nota.xml')).toBeNull();
    expect(refusedUploadFile('..\\fora.txt')).not.toBeNull();
    expect(refusedUploadFile('a\\..\\..\\fora.txt')).not.toBeNull();
    expect(refusedUploadFile('D:\\outro\\disco.txt')).not.toBeNull();
    expect(refusedUploadFile('')).not.toBeNull();
    expect(refusedUploadFile('.credentials.json')).not.toBeNull();
    expect(refusedUploadFile('.env.local')).not.toBeNull();
    expect(refusedUploadFile('.git\\config')).not.toBeNull();
    expect(refusedUploadFile('chaves\\id_ed25519')).not.toBeNull();
    expect(refusedUploadFile('certificado.pfx')).not.toBeNull();
  });
});
