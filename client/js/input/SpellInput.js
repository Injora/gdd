// Spell selection vs. firing (Step 6). Number keys 1–4 and R only SELECT a
// slot (the HUD highlights it, the wand tip previews it); the left mouse button
// FIRES whatever is selected. Q (or GameClient.castSelectedSpell()) is an
// alternate trigger so headless tests without pointer lock can fire too.
//
// In the Archon form, 1–7 select an Elemental Mastery and the trigger fires it;
// R still selects the Ultimate. Pure logic, no DOM: unit-tested in Node.

export class SpellInput {
  constructor() {
    this.selected = 0; // 0–3, or 'ult'
    this.mastery = 1; // 1–7 (Archon form)
    this.archonPick = 'mastery'; // 'mastery' | 'ult'
  }

  /**
   * A key went down. Returns what it selected, or null. It never fires.
   * @returns {{action: 'select', slot: number|'ult'} | {action: 'select-mastery', key: number} | null}
   */
  key(code, { archon = false, shift = false } = {}) {
    if (shift) return null; // (Shift+1–7 is the debug wizard swap)
    if (archon) {
      if (/^Digit[1-7]$/.test(code)) {
        this.mastery = Number(code.slice(5));
        this.archonPick = 'mastery';
        return { action: 'select-mastery', key: this.mastery };
      }
      if (code === 'KeyR') {
        this.archonPick = 'ult';
        return { action: 'select', slot: 'ult' };
      }
      return null;
    }
    if (/^Digit[1-4]$/.test(code)) {
      this.selected = Number(code.slice(5)) - 1;
      return { action: 'select', slot: this.selected };
    }
    if (code === 'KeyR') {
      this.selected = 'ult';
      return { action: 'select', slot: 'ult' };
    }
    return null;
  }

  /** The trigger was pulled (LMB, Q): what to fire. */
  fire({ archon = false } = {}) {
    if (archon) return this.archonPick === 'ult' ? { action: 'cast', slot: 'ult' } : { action: 'mastery', key: this.mastery };
    return { action: 'cast', slot: this.selected };
  }
}
