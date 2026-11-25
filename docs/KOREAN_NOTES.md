# The Korean original: 퇴마전설 (Toema Jeonseol, "Legend of Ghost Hunter" / "Exorcist Legend")

"Akuma - Demon Spawn" / "Lamentation Sword" is the English release of Trigger Soft's 1998 Korean action RPG 퇴마전설 (part 1 subtitle
"통곡의 검", the Crying Sword). Korean fan pages describe the systems the port had to guess. What they gave us, and where it is used:

Sources (Korean community wiki pages and cheat sheets; the manual's own screenshots confirm the numbers):
- 나무위키 / thewiki.kr page "퇴마전설" (stat table, spell list, quest timeline, cheats)
- cheat lists on ggemguide.com, gamess.co.kr and a Daum cafe board ("[퇴마전설]치트키")
- manual screenshots in MANUAL/ (INVEN1.JPG Kusa level 10, QUICK_~2.JPG Elim level 1)

## Stats (per point) - now in `game/stats.ts`
- Health: defense 0.2, life 1.3, carry weight 1.5
- Strength: attack 0.4, defense 0.1, life 0.6, carry weight 3
- Magic: mana 1.7, spell power, magic resistance, spell learning speed
- Dexterity: attack 0.1, defense 0.1, move speed 0.3 (cap 50), attack speed 0.4
- Intelligence: mana 0.3, skill 0.4 (hit chance, chance to ignore damage and flinching, slower weapon wear)
- Checked against the manual screens: Kusa level 10 (Saver Blade attack 75): 75 + 0.4 x 32 + 0.1 x 14 = 89 attack as printed;
  mana 99 + 1.7 x 71 + 0.3 x 44 = 233 as printed; Elim level 1 life 83 + 1 + 1.3 x 23 + 0.6 x 25 = 129 as printed;
  carry weight 200 + 3 x Strength + 1.5 x Health (base stats) = 309 (Elim) and 317 (Kusa) as printed.
- Shields cost Dexterity (item stat "special": Wooden Shield Dex-5, which is why Elim's 14 shows as 9). Elim starts at
  Health 23, Strength 25, Magic 15, Dexterity 14, Intelligence 16.
- Item stat `life` in itemstats.json is durability: weapons wear out with use and a blacksmith repairs them (not ported yet);
  Intelligence slows the wear; Raening's arrows are never used up at Intelligence 100+.
- Level-up gives points the player spends (the yellow + on each HUD portrait); we hand them out automatically (`LEVEL_GAIN`).

## Spells (Korean order; English build drops Seal Magic from the list and adds Resurrection) - mana costs match itemstats.json
Fire Wall 35, Fire Ball 20, Spirit bolt (Ghost Bolt) 40, 공전파 (Death Spark) 65, 지열파 (Lightning: sparks that follow the caster;
the community's favourite) 35, 지폭술 (Blood Fire: area damage over time) 45, Stone Curse 120, Buddha Shield (금강불괴술: immune to melee) 100 (English: 60),
Healing 35 (English: 30), Ice Rain 20, Fire Rain 47. Casting is slow; Kusa learns far faster than Elim. Healing is Raening's job.

## Clock and quests
- "Quests appear as time passes, not by talking to NPCs" - the year clock is real. Known dates: year 102 scale quest (item merchant /
  Yellow Spring River), year 105 chief's request (Western Village chief -> Bisun Village merchant; the only quest with a deadline: it
  cannot be started after 105), year 114 phoenix feather (Eastern Village item merchant, Buyeo cave, needs Magic 40+ - gear counts) and the
  north-castle witch's cave pills, year 120 Shining's rescue (Elim must speak to her; Kusa and Elim go, Raening waits).
- The Mantis trainer, Shining and the White Lady chains all hang off these dates; `pickBlock` already uses the script headers' years.
- No page gives the length of a year in real time. The cheat "The blue earth is rolling now N" (LANG ui 70) jumps N years, which also
  explains the spinning globe on the Year panel.

## Cheat codes (single player, typed after pressing Enter in the original) - now in `game/cheats.ts`
English LANG ui 63-72: Yougainasoneplease, IfIwantIgotit, ISM, Seethesilverlining, ThesoulHunter'sholyPower, MO, SHOWMETHENARA,
Theblueearthisrollingnow, END, WHATISHAPPENTORENINGSIR?. The Korean list (same order of ideas): strength/health/intelligence/dexterity/
magic +N, level +N, drop item N, drop item N x S, raise spell N by S levels, remove fog, show the map, years +N, get the Crying Sword.
Item numbers follow the equipment ids in itemstats.json (swords 1-33, bows 41-56, shields 61-69, caps 71-77, armour 81-91,
shoes 101-110, rings 111-124, necklaces 131-142, consumables 151-168, pills 171-175, talismans 176-181, quest goods 201-254).
The three stat/spell codes and the sword code could not be matched to English words and are not implemented.

## Map darkness
Items 157 "Darkness Echo" (remove the darkness) and 177 "Holy Eye" light up the area; 158 "Distant Viewer" adds Sight. The minimap
starts black and fills in as the party walks (manual screenshots); those items and SHOWMETHENARA reveal the whole map.

## Still unknown
Length of a game year, monster stats and experience, shop stock (prices are in itemstats.json), which gear gives Skill, damage
formula (how Attack and Defense combine, how Skill's damage-ignore chance rolls), exact fog/"darkness" behaviour on the main view.

## What the port does with it (guesses marked)
- Per-hero stats and 9 points per level for the player to spend (guess from Elim 93 at level 1 and Kusa 175 at level 10). Kusa's and
  Raening's starting stats are guesses; Elim's are printed in the manual.
- Skill = Intelligence x 0.4 + Skill stat; chance to ignore a blow = Skill / 200 (capped 50%) - the wiki gives no figure.
- Dexterity: move speed +0.3% per point (cap 50%), attack animation +0.4% per point; weapon speed 4 is the baseline, 5% per point (guess).
- Durability, repair prices and the over-weight slowdown are guesses (see `game/durability.ts`, `game/weight.ts`).
