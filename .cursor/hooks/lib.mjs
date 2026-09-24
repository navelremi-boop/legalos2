// Utilitaires communs aux hooks (Node, multiplateforme : Windows, macOS, Linux).
export function lireEntree() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}

export function repondre(objet) {
  process.stdout.write(JSON.stringify(objet));
  process.exit(0);
}
