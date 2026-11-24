# Quest outline (from the disc manual, `MANUAL/STRATEGY.HTM`, paraphrased)

Use this to check the scripted story against the original design. Village names match the map table
(T1 Western, T2 Mantis, T3 Stone, T4 Eastern, T5 Vulcan, T6 Bear). The guide also says "Seven Arrows" and
"Deep Waters" village, which are not in the map table (probably earlier names of Vulcan / Bear).

## Heroes
Elim: swordsman, high Dexterity and Health. Kusa: magician (Fire Wall, Fire Ball). Raening: long-range archer.
The scripts test NUM 1 / 2 / 3 for "hero 1 / 2 / 3 is in the party". If a hero dies a companion can revive them.

## Going to the underworld needs three things
1. Training with the Trainer in Mantis Village (script: level >= 16 and Strength >= 60; the guide says Dexterity 60;
   first the King tiger at Caedda must be killed for the Dragon Tattoo).
2. The Breath Sword, released from the God-Stone in Stone Village (needs the Pass Sword from Shining, holy well water
   from Ompherjo, and the spell the Retired General teaches).
3. Blowing up the Dragon Cave Gate near Stone Village (Patewoos at the gate tells you about it).

## Side quests, upper world
- Western Village: Shopkeeper's scales (Shadow Mountain); Item Merchant's crystal (Yellow river / Dinyc); Village Chief's
  deer horns from his brother in Mantis Village; a magician at Mantis Beach sells the stone spell for money.
- Eastern Village: Blacksmith's dragon scales under the totem pole; Witch's dragon tears (twin-headed demon, Turtle
  valley); Item Merchant's phoenix feathers (Death Rattle cave); White Lady's daughter (ginseng); marry Shining only if
  Elim passed the Trainer.
- Stone Village: Witch's strength training ("not everyone can be trusted"); the Witch's true identity (Jeweler hints).
- Mantis Village: Jeweler's magic mushrooms.

## Underworld
- Vulcan Village: retired devil hunter's Ganza potion (Totem Mountain old man); Jeweler's BlueMoon crystal (Four Winds
  valley); Intermediary: kill Hellminor, holy well water, Devil's Scale from Tomb cave; Knight wants the Heaven Bow
  (Hook demon, Cave of Bones).
- Bear Village: Intermediary quests (Devil's Cemetery knight demon, mandrake roots, 40,000 gold for the Saver Blade,
  tea leaves, vampire nails for the golden shield).
- Main: Shopkeeper tells of the incantation doll -> Doll-Maker (Spider cave); Raedina + Raegios explain the Blood Sword,
  recited over the sword at Soul Castle; then bring it to Wizard Raegios, take the crystal key south of the castle to the
  Endless cave and kill Satan.

## Timing
The guide lists "year" numbers per quest (102-123) as if events unlock over game time. No script condition tests time
(only NUM / ITEM / ORDER / LEVEL / MONEY / MAGIC / stats), so those years are probably the in-game order of the chain.
