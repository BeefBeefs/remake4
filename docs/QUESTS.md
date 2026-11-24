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

## Timing (the game clock)
The manual says "many events in the world happen after a certain amount of time in the game has elapsed" and lists each
overworld quest with a year (102-123); the underworld has none. The last header number of every script entry (`# 115`
below `# FLOW`) is that year (underworld entries all say 100). The save screen has a "Year" label too. The port keeps a
clock (`src/game/clock.ts`, starts at 100, one year per 90 s of play - a guess; `?year=123` in the URL jumps ahead):
an entry only answers once its year has come, and where one object has several entries the latest unlocked one wins
(White Lady: ginseng/marriage at 115, "rescue Shining" at 120). A finished quest (`CHANGE 0`) leaves the object on its
plain entry until an entry with a later year unlocks.
