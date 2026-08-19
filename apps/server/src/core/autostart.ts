/**
 * Démarrage avec la session, piloté depuis les réglages.
 *
 * Seule l'enveloppe de bureau sait inscrire l'application au démarrage: c'est
 * une affaire de système, pas de serveur. Elle fournit donc les deux fonctions
 * ici, et l'interface les appelle comme n'importe quel autre réglage.
 *
 * Pourquoi ce détour: l'option n'existait que dans le menu de l'icône de la
 * zone de notification. Personne ne l'y cherche, et un utilisateur qui ne
 * l'active pas croit à tort que ses relances repartent au redémarrage.
 */

export interface AutoStart {
  get(): boolean;
  set(enabled: boolean): void;
}

let bridge: AutoStart | null = null;

export function registerAutoStart(impl: AutoStart): void {
  bridge = impl;
}

/** `null` quand l'application tourne hors du bureau: l'option n'a pas de sens. */
export function autoStartState(): boolean | null {
  if (!bridge) return null;
  try {
    return bridge.get();
  } catch {
    return null;
  }
}

export function setAutoStart(enabled: boolean): boolean {
  if (!bridge) throw new Error("Le démarrage automatique n'est disponible que dans l'application de bureau.");
  bridge.set(enabled);
  // On relit l'état plutôt que de faire confiance à l'écriture: le système
  // peut refuser, et annoncer un réglage qui n'a pas pris serait pire que rien.
  return bridge.get();
}
