// Mockup deck lists (card names + copies; cover = the card whose art is shown). Card data and TCG limits come from the local index (cards.js).
const DECK_LISTS = [
  {name:'Dark Magician', cover:'Dark Magician', active:true, edited:'2 days ago',
   main:[['Dark Magician',3],['Dark Magician Girl',2],["Magician's Rod",3],["Magician's Robe",2],["Magicians' Souls",3],['Palladium Oracle Mahad',1],
         ['Ash Blossom & Joyous Spring',3],['Effect Veiler',1],['Nibiru, the Primal Being',1],['Dark Magical Circle',3],['Eternal Soul',2],['Illusion Magic',1],
         ['Soul Servant',2],['Dark Magic Attack',1],['Thousand Knives',1],['Called by the Grave',1],['Triple Tactics Talent',1],['Pot of Prosperity',1],
         ['Dark Magic Twin Burst',1],['Infinite Impermanence',3],['The Eye of Timaeus',1],["Magicians' Combination",1],['Dark Magic Veil',1],['Crossout Designator',1]],
   extra:[['Dark Paladin',1],['Dark Cavalry',1],['The Dark Magicians',1],['Dark Magician the Dragon Knight',1],['Red-Eyes Dark Dragoon',1],['Amulet Dragon',1],
          ['Ebon Illusion Magician',1],['Dark Magician Girl the Dragon Knight',1],['Accesscode Talker',1],['I:P Masquerena',1],['Knightmare Unicorn',1],
          ['Underworld Goddess of the Closed World',1],['Knightmare Phoenix',1],['Hieratic Seal of the Heavenly Spheres',1],['Crystal Wing Synchro Dragon',1]],
   side:[['Ghost Belle & Haunted Mansion',3],['Droll & Lock Bird',2],['Dark Ruler No More',2],['Lightning Storm',2],['Evenly Matched',2],['Cosmic Cyclone',2],['Forbidden Droplet',2]]},
  {name:'Blue-Eyes', cover:'Blue-Eyes White Dragon', edited:'5 days ago',
   main:[['Blue-Eyes White Dragon',3],['Blue-Eyes Alternative White Dragon',3],['Blue-Eyes Chaos MAX Dragon',2],['Sage with Eyes of Blue',3],['The White Stone of Ancients',3],
         ['The White Stone of Legend',1],['Dictator of D.',2],['Maiden of White',3],['Ash Blossom & Joyous Spring',3],['Effect Veiler',2],['Bingo Machine, Go!!!',3],
         ['Trade-In',2],['Chaos Form',2],['Return of the Dragon Lords',2],['Called by the Grave',1],['True Light',2],['Infinite Impermanence',3]],
   extra:[['Blue-Eyes Twin Burst Dragon',1],['Blue-Eyes Ultimate Dragon',1],['Blue-Eyes Spirit Dragon',2],['Azure-Eyes Silver Dragon',1],['Hieratic Seal of the Heavenly Spheres',1],
          ['Crystal Wing Synchro Dragon',1],['Accesscode Talker',1],['Knightmare Unicorn',1],['I:P Masquerena',1],['Underworld Goddess of the Closed World',1],
          ['Dragon Master Magia',1],['Knightmare Phoenix',1],['Red-Eyes Dark Dragoon',1],['Amulet Dragon',1]],
   side:[['Ghost Belle & Haunted Mansion',3],['Dark Ruler No More',2],['Evenly Matched',2],['Cosmic Cyclone',2],['Lightning Storm',2],['Nibiru, the Primal Being',2],['Forbidden Droplet',2]]},
  {name:'Red-Eyes Fusion', cover:'Red-Eyes Black Dragon', edited:'3 weeks ago',
   main:[['Red-Eyes Black Dragon',3],['Red-Eyes Darkness Metal Dragon',1],['Red-Eyes Fusion',3],['Red-Eyes Insight',2],['Ash Blossom & Joyous Spring',3],['Called by the Grave',1]],
   extra:[['Meteor Black Dragon',1],['Black Skull Dragon',1],['Red-Eyes Dark Dragoon',1]], side:[]},
  {name:'HERO', cover:'Elemental HERO Neos', edited:'1 week ago',
   main:[['Elemental HERO Shadow Mist',3],['Elemental HERO Stratos',1],['Elemental HERO Neos',1],['Elemental HERO Liquid Soldier',3],['Polymerization',3],['Fusion Destiny',2],
         ['Mask Change',2],['E - Emergency Call',1],['Ash Blossom & Joyous Spring',3],['Infinite Impermanence',3],['Called by the Grave',1],['Effect Veiler',2],
         ['Pot of Prosperity',1],['Triple Tactics Talent',2],['Elemental HERO Bubbleman',3],['Vision HERO Vyon',2],['Elemental HERO Blazeman',2],['Favorite Hero',2],['Fusion Deployment',3]],
   extra:[['Elemental HERO Sunrise',1],['Destiny HERO - Destroyer Phoenix Enforcer',1],['Masked HERO Dark Law',1],['Elemental HERO Absolute Zero',1],['Masked HERO Anki',1],
          ['Elemental HERO Shining Neos Wingman',1],['Xtra HERO Wonder Driver',1],['Xtra HERO Dread Decimator',1],['Elemental HERO Grandmerge',1]], side:[]},
  {name:'Stardust Synchro', cover:'Stardust Dragon', edited:'1 month ago',
   main:[['Junk Synchron',3],['Quickdraw Synchron',2],['Doppelwarrior',2],['Ash Blossom & Joyous Spring',3],['Effect Veiler',2],['Infinite Impermanence',3],['Called by the Grave',1]],
   extra:[['Stardust Dragon',1],['Junk Warrior',1],['Junk Speeder',1],['Shooting Star Dragon',1]], side:[]},
  {name:'Exodia (testing)', cover:'Exodia the Forbidden One', edited:'2 months ago',
   main:[['Exodia the Forbidden One',1],['Right Arm of the Forbidden One',1],['Left Arm of the Forbidden One',1],['Right Leg of the Forbidden One',1],['Left Leg of the Forbidden One',1],
         ['Pot of Greed',1],['Upstart Goblin',3],['Pot of Duality',3],['Magical Mallet',1],['Card Destruction',1],['Pot of Prosperity',1]], extra:[], side:[]},
];


const EXTRA_FRAMES = ['fusion','synchro','xyz','link','fusion_pendulum','synchro_pendulum','xyz_pendulum'];
const isExtra = c => EXTRA_FRAMES.includes(c.frameType);
const kindOf = c => c.frameType === 'spell' ? 'spell' : c.frameType === 'trap' ? 'trap' : 'monster';
const limitOf = c => ({Forbidden:0, Limited:1, 'Semi-Limited':2}[c.banlist_info?.ban_tcg] ?? 3);

// TCG Advanced Format checks: 40-60 main, 0-15 extra/side, copy limits
function deckProblems(zones, cards){
  const n = z => zones[z].length;
  const out = [];
  if (n('main') < 40) out.push(`Main Deck has ${n('main')} cards (minimum 40)`);
  if (n('main') > 60) out.push(`Main Deck has ${n('main')} cards (maximum 60)`);
  if (n('extra') > 15) out.push(`Extra Deck has ${n('extra')} cards (maximum 15)`);
  if (n('side') > 15) out.push(`Side Deck has ${n('side')} cards (maximum 15)`);
  const copies = {};
  ['main','extra','side'].forEach(z => zones[z].forEach(id => copies[id] = (copies[id] || 0) + 1));
  Object.entries(copies).forEach(([id, k]) => {
    const c = cards[id], lim = limitOf(c);
    if (k > lim) out.push(lim === 0 ? `${c.name} is Forbidden` : `${c.name}: ${k} copies (limit ${lim})`);
  });
  return out;
}
