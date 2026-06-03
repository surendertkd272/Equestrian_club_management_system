// HQ-curated equipment catalog — the master list of item types per category,
// from the club's "Horse Tack List" sheet. Categories use the canonical keys
// (lib/schemas/equipment.ts EQUIPMENT_CATEGORIES) so they render in the fixed
// order: tack → grooming → stable → rider → farrier → sports → vet → other.
//
// This is the single source of truth: prisma/seed.ts upserts it for fresh DBs,
// and the data migration replace_equipment_catalog applies it to existing ones.
export type CatalogSeedItem = {
  category: string;
  code: string;
  name: string;
  unit: string;
  defaultThreshold: number;
  notes?: string;
};

export const EQUIPMENT_CATALOG: CatalogSeedItem[] = [
  // ── Tack (Horse equipment / tack) ──
  { category: "tack", code: "tack_saddles", name: "Saddles", unit: "piece", defaultThreshold: 5, notes: "Colour, Jumping Saddle, Trooper saddle, Polo Saddle etc" },
  { category: "tack", code: "tack_bridles", name: "Bridles", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_stirrup_belt", name: "Stirrup Belt", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_stirrup_steel", name: "Stirrup Steel", unit: "pair", defaultThreshold: 5 },
  { category: "tack", code: "tack_reins", name: "Reins", unit: "pair", defaultThreshold: 5 },
  { category: "tack", code: "tack_bit", name: "Bit", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_snaffle", name: "Snaffle", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_pelham", name: "Pelham", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_curb_bit", name: "Curb Bit", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_girth", name: "Girth", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_halter", name: "Halter", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_saddle_pad", name: "Saddle Pad", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_gel_pad", name: "Gel Pad", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_fur_pad", name: "Pur Pad / Fur Pads", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_blanket", name: "Blanket", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_noseband", name: "Noseband", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_martingale", name: "Martingale", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_muzzle", name: "Muzzle", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_earnet", name: "Earnet", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_hoof_cover", name: "Hoof Cover", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_bandage_wraps", name: "Horse Bandage Wraps", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_breastplate", name: "Breastplate / Breastcollar", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_blinkers", name: "Blinkers", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_crupper", name: "Crupper", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_tendon_boots", name: "Bell / Tendon Boots", unit: "pair", defaultThreshold: 5 },
  { category: "tack", code: "tack_lunging_reins", name: "Lunging Reins", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_side_reins", name: "Side Reins", unit: "pair", defaultThreshold: 5 },
  { category: "tack", code: "tack_over_girth", name: "Over Girth", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_winter_blanket", name: "Winter Blanket / Jhool", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_lance_holder", name: "Lance Holder", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_pony_saddle", name: "Pony Saddles", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_pony_bridle", name: "Pony Bridles", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_pony_bit", name: "Pony Bits", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_pony_stirrup", name: "Pony Stirrups", unit: "pair", defaultThreshold: 5 },

  // ── Grooming Kit ──
  { category: "grooming", code: "groom_curry_comb", name: "Curry Comb", unit: "piece", defaultThreshold: 5 },
  { category: "grooming", code: "groom_dandy_brush", name: "Dandy Brush", unit: "piece", defaultThreshold: 5 },
  { category: "grooming", code: "groom_body_brush", name: "Body Brush", unit: "piece", defaultThreshold: 5 },
  { category: "grooming", code: "groom_mane_tail_brush", name: "Mane & Tail Brush / Comb", unit: "piece", defaultThreshold: 5 },
  { category: "grooming", code: "groom_hoof_pick", name: "Hoof Pick", unit: "piece", defaultThreshold: 5 },
  { category: "grooming", code: "groom_rubber_gloves", name: "Rubber Gloves", unit: "pair", defaultThreshold: 5 },
  { category: "grooming", code: "groom_sponges_cloth", name: "Sponges & Cloth", unit: "piece", defaultThreshold: 5 },
  { category: "grooming", code: "groom_massage_pad", name: "Massage Pad", unit: "piece", defaultThreshold: 5 },
  { category: "grooming", code: "groom_sweat_scraper", name: "Sweat Scraper", unit: "piece", defaultThreshold: 5 },
  { category: "grooming", code: "groom_hoof_brush", name: "Hoof Brush", unit: "piece", defaultThreshold: 5 },
  { category: "grooming", code: "groom_hoof_oil", name: "Hoof Oil", unit: "litre", defaultThreshold: 5 },
  { category: "grooming", code: "groom_scissors", name: "Scissors", unit: "piece", defaultThreshold: 5 },
  { category: "grooming", code: "groom_fly_spray", name: "Fly Spray", unit: "piece", defaultThreshold: 5 },
  { category: "grooming", code: "groom_coat_polish", name: "Coat Polish", unit: "piece", defaultThreshold: 5 },
  { category: "grooming", code: "groom_shampoo", name: "Shampoo / Conditioner", unit: "litre", defaultThreshold: 5 },
  { category: "grooming", code: "groom_fleece_machine", name: "Fleece Removing Machine", unit: "piece", defaultThreshold: 5 },

  // ── Stable Equipment ──
  { category: "stable", code: "stable_hay_net", name: "Hay Net", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_mats", name: "Stable Mats", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_fans", name: "Fans", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_coolers", name: "Coolers", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_buckets", name: "Buckets", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_fodder_tub", name: "Fodder Mix Tub", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_forked_spade", name: "Forked Hay Spade (Punji)", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_spade", name: "Spade", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_waste_trolley", name: "Waste Trolley", unit: "piece", defaultThreshold: 5 },

  // ── Rider's Equipment ──
  { category: "rider", code: "rider_helmet", name: "Helmet", unit: "piece", defaultThreshold: 5 },
  { category: "rider", code: "rider_breeches", name: "Breeches", unit: "piece", defaultThreshold: 5 },
  { category: "rider", code: "rider_long_boots", name: "Long Boots", unit: "pair", defaultThreshold: 5 },
  { category: "rider", code: "rider_short_boots", name: "Short Boots", unit: "pair", defaultThreshold: 5 },
  { category: "rider", code: "rider_chest_guard", name: "Chest Guard", unit: "piece", defaultThreshold: 5 },
  { category: "rider", code: "rider_whip", name: "Whip", unit: "piece", defaultThreshold: 5 },
  { category: "rider", code: "rider_spurs", name: "Spurs", unit: "pair", defaultThreshold: 5 },
  { category: "rider", code: "rider_chaps", name: "Chaps", unit: "pair", defaultThreshold: 5 },
  { category: "rider", code: "rider_tshirts", name: "T-Shirts", unit: "piece", defaultThreshold: 5 },
  { category: "rider", code: "rider_caps", name: "Caps", unit: "piece", defaultThreshold: 5 },
  { category: "rider", code: "rider_track_suits", name: "Track Suits", unit: "piece", defaultThreshold: 5 },
  { category: "rider", code: "rider_gloves", name: "Gloves", unit: "pair", defaultThreshold: 5 },
  { category: "rider", code: "rider_knee_guard", name: "Knee Guard", unit: "pair", defaultThreshold: 5 },

  // ── Sports Equipment ──
  { category: "sports", code: "sport_polo_mallet", name: "Polo Mallet", unit: "piece", defaultThreshold: 5, notes: "Sizes" },
  { category: "sports", code: "sport_polo_balls", name: "Polo Balls", unit: "piece", defaultThreshold: 5, notes: "Types" },
  { category: "sports", code: "sport_lance_intl", name: "Lance International", unit: "piece", defaultThreshold: 5, notes: "2 Piece" },
  { category: "sports", code: "sport_lance_indian", name: "Lance Indian", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_ceremonial_lance", name: "Ceremonial Lance", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_sword_intl", name: "Sword International", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_lance_bag", name: "Lance Bag", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_sword_bag", name: "Sword Bag", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_pegs", name: "Pegs", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_ring_stands", name: "Ring Stands", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_jumping_wings", name: "Jumping Wings", unit: "pair", defaultThreshold: 5 },
  { category: "sports", code: "sport_jumping_poles", name: "Jumping Poles", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_red_flags", name: "Red Flags", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_white_flags", name: "White Flags", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_pole_blocks", name: "Pole Number Blocks", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_measuring_wheel", name: "Measuring Wheel", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_rings_tp", name: "Rings TP", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_dressage_markers", name: "Dressage Markers", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_jumping_hooks", name: "Jumping Hooks", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_polo_casket", name: "Polo Wooden Casket", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_stop_watch", name: "Stop Watch", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_riding_bibs", name: "Riding Bibs", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_marking_cones", name: "Marking Cones", unit: "piece", defaultThreshold: 5 },
  { category: "sports", code: "sport_mls_stand", name: "Mallet / Lance / Sword Stand", unit: "piece", defaultThreshold: 5 },

  // ── Vet Equipment & Medicines ──
  { category: "vet", code: "vet_thermometer", name: "Thermometer", unit: "piece", defaultThreshold: 5 },
];
