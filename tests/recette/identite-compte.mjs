#!/usr/bin/env node
/**
 * Initiales de l'avatar du compte (Coque claire) : nom, adresse, cas limites.
 * Usage : node tests/recette/identite-compte.mjs
 */
import assert from "node:assert/strict";
import { initialesDepuis } from "../../apps/poste/src/lib/initiales.ts";

const cas = [
  // nom : première lettre du premier et du dernier mot
  ["Jeanne Moreau", null, "JM"],
  ["  jeanne   moreau  ", null, "JM"],
  ["Jean-Pierre Durand", null, "JD"],
  ["Marie Anne de la Fontaine", null, "MF"],
  ["Élodie Martin", null, "ÉM"],
  ["Rémi", null, "R"],
  // le nom prime sur l'adresse
  ["Jeanne Moreau", "autre.personne@cabinet.example", "JM"],
  // adresse quand le nom est absent ou vide
  [null, "jeanne.moreau@cabinet.example", "JM"],
  ["", "jeanne_moreau@cabinet.example", "JM"],
  ["   ", "jeanne-moreau@cabinet.example", "JM"],
  [undefined, "jeanne+tri@cabinet.example", "JT"],
  [null, "contact@cabinet.example", "C"],
  [null, "a.b.c@cabinet.example", "AC"],
  // rien d'exploitable
  [null, null, null],
  ["", "", null],
  ["   ", "   ", null],
  [null, "@cabinet.example", null],
  [null, "..@cabinet.example", null],
  // lettres hors BMP : pas de caractère coupé en deux
  ["𝒜lice 𝒷ob", null, "𝒜𝒷".toLocaleUpperCase("fr")],
];

for (const [nom, email, attendu] of cas) {
  const obtenu = initialesDepuis(nom, email);
  assert.equal(obtenu, attendu, `initialesDepuis(${JSON.stringify(nom)}, ${JSON.stringify(email)}) = ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`);
}

// essai négatif : une implémentation qui ne prend que la première lettre du nom échouerait
const naive = (nom) => (nom ?? "").trim().charAt(0).toUpperCase() || null;
assert.notEqual(naive("Jeanne Moreau"), initialesDepuis("Jeanne Moreau", null), "l'essai négatif doit distinguer les deux calculs");

console.log(`identite-compte: OK — ${cas.length} cas (nom, adresse, vides, lettres hors BMP)`);
