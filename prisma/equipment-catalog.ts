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
  // "Jhool" is the Hindi term for horse blanket — one consolidated entry
  // (the old separate "Winter Blanket / Jhool" row was merged into this one).
  { category: "tack", code: "tack_blanket", name: "Blanket / Jhool", unit: "piece", defaultThreshold: 5 },
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
  // tack_winter_blanket removed — merged into tack_blanket ("Blanket / Jhool");
  // the data script deactivated the DB row and moved its stock across.
  { category: "tack", code: "tack_lance_holder", name: "Lance Holder", unit: "piece", defaultThreshold: 5 },
  // "Pisova" in field lists = Pessoa (brand) lunging training system.
  { category: "tack", code: "tack_pessoa_lunging", name: "Pessoa Lunging System", unit: "set", defaultThreshold: 1, notes: "aka 'Pisova' in field lists" },
  { category: "tack", code: "tack_iron_stirrups_small", name: "Iron Stirrups (Small)", unit: "pair", defaultThreshold: 5 },
  { category: "tack", code: "tack_leather_stirrups", name: "Leather Stirrups", unit: "pair", defaultThreshold: 5 },
  { category: "tack", code: "tack_girth_rein", name: "Girth Rein", unit: "piece", defaultThreshold: 5 },
  { category: "tack", code: "tack_lunge_whip_small", name: "Lungeing / Dressage Whip (Small)", unit: "piece", defaultThreshold: 5 },
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
  // Mounting stands tracked as separate Small/Big line items per GHRC
  // convention — do NOT consolidate into one entry.
  { category: "stable", code: "stable_mounting_stand_small", name: "Mounting Stand (Small)", unit: "piece", defaultThreshold: 2 },
  { category: "stable", code: "stable_mounting_stand_big", name: "Mounting Stand (Big)", unit: "piece", defaultThreshold: 2 },
  { category: "stable", code: "stable_hay_net", name: "Hay Net", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_mats", name: "Stable Mats", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_fans", name: "Fans", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_coolers", name: "Coolers", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_buckets", name: "Buckets", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_fodder_tub", name: "Fodder Mix Tub", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_forked_spade", name: "Forked Hay Spade (Punji)", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_spade", name: "Spade", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_waste_trolley", name: "Waste Trolley", unit: "piece", defaultThreshold: 5 },
  { category: "stable", code: "stable_front_curtains", name: "Stable Front Curtains", unit: "piece", defaultThreshold: 2 },
  { category: "stable", code: "stable_aluminium_box", name: "Aluminium Box", unit: "piece", defaultThreshold: 1 },
  { category: "stable", code: "stable_almirah", name: "Almirah", unit: "piece", defaultThreshold: 1 },
  { category: "stable", code: "stable_fridge", name: "Fridge", unit: "piece", defaultThreshold: 1 },
  { category: "stable", code: "stable_notice_board", name: "Notice Board", unit: "piece", defaultThreshold: 1 },
  { category: "stable", code: "stable_watering_pipe", name: "Ground Watering Pipe", unit: "piece", defaultThreshold: 2 },
  { category: "stable", code: "stable_sprinklers", name: "Sprinklers", unit: "piece", defaultThreshold: 2 },
  { category: "stable", code: "stable_plants", name: "Plants", unit: "piece", defaultThreshold: 5 },

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
  // ── Sized riding gear — per GHRC convention each size is its own line item
  // so per-size quantities are countable. The unsized base rows above stay for
  // legacy/unsorted stock; new counting should use the sized rows.
  { category: "rider", code: "rider_helmet_xs", name: "Helmet (XS)", unit: "piece", defaultThreshold: 2 },
  { category: "rider", code: "rider_helmet_s", name: "Helmet (S)", unit: "piece", defaultThreshold: 2 },
  { category: "rider", code: "rider_helmet_m", name: "Helmet (M)", unit: "piece", defaultThreshold: 2 },
  { category: "rider", code: "rider_helmet_l", name: "Helmet (L)", unit: "piece", defaultThreshold: 2 },
  { category: "rider", code: "rider_helmet_xl", name: "Helmet (XL)", unit: "piece", defaultThreshold: 2 },
  { category: "rider", code: "rider_riding_boots_s", name: "Riding Boots (S)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_riding_boots_m", name: "Riding Boots (M)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_riding_boots_l", name: "Riding Boots (L)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_riding_boots_xl", name: "Riding Boots (XL)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_short_boots_s", name: "Short Boots (S)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_short_boots_m", name: "Short Boots (M)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_short_boots_l", name: "Short Boots (L)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_short_boots_xl", name: "Short Boots (XL)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_chaps_s", name: "Chaps (S)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_chaps_m", name: "Chaps (M)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_chaps_l", name: "Chaps (L)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_chaps_xl", name: "Chaps (XL)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_gloves_s", name: "Gloves (S)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_gloves_m", name: "Gloves (M)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_gloves_l", name: "Gloves (L)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_gloves_xl", name: "Gloves (XL)", unit: "pair", defaultThreshold: 2 },
  { category: "rider", code: "rider_chest_guard_s", name: "Chest Guard (S)", unit: "piece", defaultThreshold: 2 },
  { category: "rider", code: "rider_chest_guard_m", name: "Chest Guard (M)", unit: "piece", defaultThreshold: 2 },
  { category: "rider", code: "rider_chest_guard_l", name: "Chest Guard (L)", unit: "piece", defaultThreshold: 2 },
  { category: "rider", code: "rider_chest_guard_xl", name: "Chest Guard (XL)", unit: "piece", defaultThreshold: 2 },

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
  // Tent pegging & equestrian sport additions (field request, July 2026).
  { category: "sports", code: "sport_sword_indian", name: "Sword Indian", unit: "piece", defaultThreshold: 2 },
  { category: "sports", code: "sport_peg_angle", name: "Peg Angle", unit: "piece", defaultThreshold: 2 },
  { category: "sports", code: "sport_balloon_lance", name: "Balloon Bursting Lance", unit: "piece", defaultThreshold: 2 },
  { category: "sports", code: "sport_stabling_tent", name: "Stabling Tent Items", unit: "set", defaultThreshold: 1 },
  { category: "sports", code: "sport_jury_box", name: "Jury Box", unit: "piece", defaultThreshold: 1 },

  // ── Vet Equipment & Medicines ──
  { category: "vet", code: "vet_thermometer", name: "Thermometer", unit: "piece", defaultThreshold: 5 },

  // ── Arena, Facility & Electronics (field request, July 2026) ──
  { category: "other", code: "other_equiwings_arena", name: "Equiwings Arena", unit: "set", defaultThreshold: 1 },
  { category: "other", code: "other_kenop_equiwings", name: "Kenop (Equiwings)", unit: "piece", defaultThreshold: 1 },
  { category: "other", code: "other_kenop_syl", name: "Kenop (Syl)", unit: "piece", defaultThreshold: 1 },
  { category: "other", code: "other_chairs_tables", name: "Chairs & Tables", unit: "piece", defaultThreshold: 5 },
  { category: "other", code: "other_foot_boards", name: "Foot Boards", unit: "piece", defaultThreshold: 2 },
  { category: "other", code: "other_cooler_stand", name: "Cooler Stand", unit: "piece", defaultThreshold: 1 },
  { category: "other", code: "other_cameras", name: "Cameras (CCTV)", unit: "piece", defaultThreshold: 1 },
  { category: "other", code: "other_teachers_mic", name: "Teacher's Mic", unit: "piece", defaultThreshold: 1 },
  { category: "other", code: "other_tube_light", name: "Tube Light", unit: "piece", defaultThreshold: 2 },
  { category: "other", code: "other_bulb", name: "Bulb", unit: "piece", defaultThreshold: 2 },
];
