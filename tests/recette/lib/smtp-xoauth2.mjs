/**
 * Relais SMTP minimal qui n'accepte que `AUTH XOAUTH2` (RFC : « user=… ^A auth=Bearer … ^A ^A »), pour prouver que
 * l'envoi d'un mail d'une boîte OAuth présente bien un jeton d'accès valide. Données fictives, aucun TLS (le
 * chiffrement du transport est éprouvé ailleurs).
 */
import { createServer } from "node:net";

/**
 * @param {{ port: number, verifier: (jeton: string) => string | null, hote?: string }} options
 *   `verifier` rend l'adresse à laquelle appartient le jeton, ou `null` s'il est refusé.
 */
export async function demarrerSmtpXoauth2({ port, verifier, hote = "0.0.0.0" }) {
  const messages = [];
  const authentifications = { reussies: 0, refusees: 0 };

  const serveur = createServer((socket) => {
    socket.setEncoding("utf8");
    let tampon = "";
    let enDonnees = false;
    let courant = null;
    let authentifie = null;
    const dire = (ligne) => socket.write(`${ligne}\r\n`);
    dire("220 simulateur-smtp ESMTP");

    const traiterLigne = (ligne) => {
      if (enDonnees) return;
      const commande = ligne.toUpperCase();
      if (commande.startsWith("EHLO") || commande.startsWith("HELO")) {
        socket.write("250-simulateur-smtp\r\n250-AUTH XOAUTH2\r\n250 8BITMIME\r\n");
      } else if (commande.startsWith("AUTH XOAUTH2")) {
        const argument = ligne.slice("AUTH XOAUTH2".length).trim();
        const decode = Buffer.from(argument, "base64").toString("utf8");
        const m = /^user=(.*)\u0001auth=Bearer (.*)\u0001\u0001$/su.exec(decode);
        const adresse = m ? verifier(m[2]) : null;
        if (m && adresse && adresse === m[1]) {
          authentifie = adresse;
          authentifications.reussies += 1;
          dire("235 2.7.0 Authentication successful");
        } else {
          authentifications.refusees += 1;
          dire("535 5.7.3 Authentication unsuccessful");
        }
      } else if (commande.startsWith("MAIL FROM")) {
        if (!authentifie) {
          dire("530 5.7.0 Authentication required");
          return;
        }
        courant = { authentifie, de: ligne.slice(ligne.indexOf(":") + 1).trim().replace(/[<>]/gu, ""), a: [], donnees: "" };
        dire("250 2.1.0 OK");
      } else if (commande.startsWith("RCPT TO")) {
        courant?.a.push(ligne.slice(ligne.indexOf(":") + 1).trim().replace(/[<>]/gu, ""));
        dire("250 2.1.5 OK");
      } else if (commande === "DATA") {
        enDonnees = true;
        dire("354 End data with <CR><LF>.<CR><LF>");
      } else if (commande === "QUIT") {
        dire("221 2.0.0 Bye");
        socket.end();
      } else if (commande === "RSET" || commande === "NOOP") {
        dire("250 2.0.0 OK");
      } else {
        dire("502 5.5.2 Command not recognized");
      }
    };

    socket.on("data", (morceau) => {
      tampon += morceau;
      for (;;) {
        if (enDonnees) {
          const fin = tampon.indexOf("\r\n.\r\n");
          if (fin < 0) return;
          if (courant) {
            courant.donnees = tampon.slice(0, fin);
            messages.push(courant);
          }
          tampon = tampon.slice(fin + 5);
          enDonnees = false;
          courant = null;
          dire("250 2.0.0 Queued");
          continue;
        }
        const coupure = tampon.indexOf("\r\n");
        if (coupure < 0) return;
        const ligne = tampon.slice(0, coupure);
        tampon = tampon.slice(coupure + 2);
        traiterLigne(ligne);
      }
    });
    socket.on("error", () => {});
  });

  await new Promise((resolve, reject) => {
    serveur.once("error", reject);
    serveur.listen(port, hote, resolve);
  });
  return {
    port,
    messages,
    authentifications,
    arreter: () => new Promise((resolve) => serveur.close(() => resolve())),
  };
}
