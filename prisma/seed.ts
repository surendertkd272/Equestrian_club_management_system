import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { FEATURE_KEYS } from "../lib/features";
import { EQUIPMENT_CATALOG } from "./equipment-catalog";

const prisma = new PrismaClient();

// Canonical Equiwings rubric for general Levels 1–4. Pre-fills
// ExamLevel.defaultRubricJson so every centre starts with a real rubric;
// centres can override per-centre via ScoringTemplate.
const EQUIWINGS_RUBRICS: Record<string, { levelName: string; passThreshold: number; categories: any[] }> = (() => {
  try {
    const p = path.join(process.cwd(), "prisma", "equiwings-level-rubrics.json");
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// Static catalogs (shared by every club)
// ─────────────────────────────────────────────────────────────────────────────

// Flatten a rubric category's items into Skill rows. Sub-items become
// "Parent — Child" composite names. Same shape used by lib/centre-bootstrap.
function flattenRubricSkills(categories: any[]): { discipline: string; name: string }[] {
  const out: { discipline: string; name: string }[] = [];
  for (const cat of categories ?? []) {
    for (const item of cat.items ?? []) {
      if (Array.isArray(item.subitems) && item.subitems.length > 0) {
        for (const sub of item.subitems) {
          out.push({ discipline: cat.name, name: `${item.name} — ${sub.name}` });
        }
      } else {
        out.push({ discipline: cat.name, name: item.name });
      }
    }
  }
  return out;
}

const LEVEL_1_RUBRIC = [
  {
    name: "Dress & Equipment",
    items: [
      { name: "Helmet (ASTM/ISI certified)", max_score: 5 },
      { name: "Boots / jodhpurs", max_score: 5 },
      { name: "Gloves", max_score: 2 },
    ],
  },
  {
    name: "Stable Management",
    items: [
      { name: "Approach & handling", max_score: 5 },
      { name: "Grooming basics", max_score: 5 },
      { name: "Tacking up assistance", max_score: 5 },
    ],
  },
  {
    name: "Riding Position",
    items: [
      { name: "Seat", max_score: 10 },
      { name: "Hands & contact", max_score: 10 },
      { name: "Heels down / leg position", max_score: 5 },
    ],
  },
  {
    name: "Basic Paces",
    items: [
      { name: "Halt / mount / dismount", max_score: 5 },
      { name: "Walk on a circle", max_score: 10 },
      { name: "Rising trot (straight line)", max_score: 10 },
    ],
  },
  {
    name: "Remarks by Jury",
    type: "text" as const,
    items: [{ name: "Overall observations", max_score: 0 }],
  },
];

const LEVEL_2_RUBRIC = [
  {
    name: "Dress & Equipment",
    items: [
      { name: "Helmet", max_score: 5 },
      { name: "Boots / jodhpurs", max_score: 5 },
    ],
  },
  {
    name: "Stable Management",
    items: [
      { name: "Independent tacking up", max_score: 8 },
      { name: "Feeding & watering knowledge", max_score: 6 },
      { name: "Identifying basic ailments", max_score: 6 },
    ],
  },
  {
    name: "Riding Position",
    items: [
      { name: "Seat", max_score: 10 },
      { name: "Hands & contact", max_score: 10 },
      { name: "Two-point at trot", max_score: 8 },
    ],
  },
  {
    name: "Paces & Transitions",
    items: [
      { name: "Sitting trot (5 strides)", max_score: 8 },
      { name: "Canter on correct lead", max_score: 12 },
      { name: "Transitions walk-trot-walk", max_score: 8 },
      { name: "Pole work (3 trot poles)", max_score: 8 },
    ],
  },
  {
    name: "Theory Questions",
    type: "select" as const,
    options: ["Correct", "Partial", "Incorrect"],
    items: [
      { name: "Parts of a saddle", max_score: 0 },
      { name: "Three points of a horse's hoof", max_score: 0 },
    ],
  },
  {
    name: "Remarks by Jury",
    type: "text" as const,
    items: [{ name: "Overall observations", max_score: 0 }],
  },
];

// Mirrors PDF §1 "Must-Have Emergency Medicines" so every new club starts with
// a fully-stocked cabinet. Days = shelf life from today (seeded as expDate).
const STANDARD_MEDS: Array<{ name: string; generic: string; cat: string; days: number; qty: number }> = [
  // NSAIDs / anti-inflammatories
  { name: "Flunixin Meglumine (Banamine)", generic: "Flunixin", cat: "nsaid", days: 200, qty: 20 },
  { name: "Phenylbutazone (Bute)", generic: "Phenylbutazone", cat: "nsaid", days: 90, qty: 8 },
  { name: "Firocoxib", generic: "Firocoxib", cat: "nsaid", days: 365, qty: 12 },
  { name: "Dexamethasone Inj.", generic: "Dexamethasone", cat: "antibiotic", days: 15, qty: 12 },
  // Allergy / antihistamine
  { name: "Chlorpheniramine Inj.", generic: "Chlorpheniramine maleate", cat: "antihistamine", days: 180, qty: 10 },
  // Gastric
  { name: "Omeprazole Paste", generic: "Omeprazole", cat: "gastric", days: 270, qty: 6 },
  // Electrolytes / hydration
  { name: "Equine Electrolyte Paste", generic: "Sodium/Potassium/Chloride blend", cat: "electrolyte", days: 540, qty: 24 },
  // Sedative — vet-only, but cabinet should have it
  { name: "Detomidine HCl", generic: "Detomidine", cat: "sedative", days: 180, qty: 4 },
  // Eye care
  { name: "Tobramycin Eye Ointment", generic: "Tobramycin", cat: "eye", days: 180, qty: 6 },
  // Wound care
  { name: "Silver Spray (Wound)", generic: "Silver sulfadiazine spray", cat: "wound", days: 540, qty: 12 },
  { name: "Povidone-Iodine Antiseptic", generic: "Povidone-iodine", cat: "wound", days: 540, qty: 8 },
  { name: "Chlorhexidine 4% Solution", generic: "Chlorhexidine gluconate", cat: "wound", days: 540, qty: 6 },
  // Tetanus — both vaccine (preventive) and antitoxin (post-wound emergency)
  { name: "Equine Tetanus Vaccine", generic: "Tetanus toxoid", cat: "vaccine", days: 400, qty: 6 },
  { name: "Tetanus Antitoxin", generic: "Tetanus antitoxin", cat: "antitoxin", days: 360, qty: 4 },
  // Dewormer
  { name: "Ivermectin Paste", generic: "Ivermectin", cat: "dewormer", days: 365, qty: 30 },
  // Client procurement list (WhatsApp 24 May) — named products the clubs
  // actually stock, plus IV fluids / probiotics Ahmed asked to keep on hand.
  { name: "Fortified Procaine Penicillin", generic: "Procaine + Benzylpenicillin", cat: "antibiotic", days: 365, qty: 14 },
  { name: "Artizon-S Inj 300ml", generic: "Immunomodulator tonic", cat: "supplement", days: 540, qty: 4 },
  { name: "Tribivet Inj 1000ml", generic: "Vitamin B-complex", cat: "supplement", days: 540, qty: 2 },
  { name: "Pyroflex Oil 500ml", generic: "Topical anti-inflammatory liniment", cat: "wound", days: 720, qty: 6 },
  { name: "Powder Ecare SC 400g", generic: "Skin & coat supplement", cat: "supplement", days: 540, qty: 6 },
  { name: "Hoof Powder", generic: "Hoof-hardening powder", cat: "hoof", days: 720, qty: 14 },
  { name: "Hoof Oil", generic: "Hoof conditioning oil", cat: "hoof", days: 720, qty: 14 },
  { name: "Calcium Liquid", generic: "Calcium gluconate oral", cat: "supplement", days: 540, qty: 14 },
  { name: "Vetade Inj 4ml", generic: "Vitamin A/D3/E", cat: "supplement", days: 540, qty: 12 },
  { name: "Repronal Inj 5ml", generic: "Reproductive vitamin tonic", cat: "supplement", days: 540, qty: 8 },
  { name: "Rantek Inj 100ml", generic: "Ranitidine", cat: "gastric", days: 365, qty: 4 },
  { name: "Livor Tonic 5L", generic: "Liver tonic", cat: "supplement", days: 540, qty: 2 },
  { name: "Apthocare Powder", generic: "Mouth/foot antiseptic powder", cat: "wound", days: 540, qty: 7 },
  { name: "Speed Liquid 1L", generic: "Energy/recovery oral tonic", cat: "supplement", days: 540, qty: 6 },
  { name: "Bandage Roll", generic: "Cotton crepe bandage", cat: "wound", days: 1080, qty: 30 },
  { name: "Hydrogen Peroxide", generic: "Hydrogen peroxide 3%", cat: "wound", days: 365, qty: 12 },
  { name: "Ringer Lactate (RL) 500ml", generic: "Compound sodium lactate IV", cat: "fluid", days: 540, qty: 48 },
  { name: "Normal Saline 0.9% 500ml", generic: "Sodium chloride IV", cat: "fluid", days: 540, qty: 48 },
  { name: "IV Administration Set", generic: "IV drip set (disposable)", cat: "fluid", days: 1080, qty: 50 },
  { name: "Equine Probiotic", generic: "Gut probiotic + prebiotic", cat: "supplement", days: 365, qty: 12 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Club specs — 4 clubs under the Equiwings (HQ) umbrella.
// One super admin sits above all of them; each club has its own stakeholder set.
// ─────────────────────────────────────────────────────────────────────────────

type Horse = {
  name: string;
  breed: string;
  sex: "M" | "F";
  ageYears: number;
  heightHh: number;
  ownership: "club" | "private";
  stableNo: string;
};

type SampleRider = {
  firstName: string;
  lastName: string;
  dob: Date;
  mobile: string;
  gender: "male" | "female";
  school?: string;
  fatherPhone?: string;
};

type ClubSpec = {
  slug: string;                    // URL slug — also used in email pattern
  name: string;
  address: string;
  managerName: string;
  headCoachName: string;
  coachName: string;
  vetName: string;
  examinerName: string;
  stableManagerName: string;
  inventoryManagerName: string;
  competitionManagerName: string;
  groomName: string;
  farrierName: string;
  accountantName: string;
  parentName: string;
  horses: Horse[];
  riders: SampleRider[];
};

const CLUBS: ClubSpec[] = [
  {
    slug: "ghaziabad",
    name: "Equiwings Ghaziabad",
    address: "Sector 16, Ghaziabad, Uttar Pradesh",
    managerName: "Ravi Kumar",
    headCoachName: "Capt. Vikram Singh",
    coachName: "Maj. Arjun Saxena",
    vetName: "Dr. Anjali Mehta",
    examinerName: "Mrs. Pooja Sharma",
    stableManagerName: "Suresh Yadav",
    inventoryManagerName: "Neha Iyer",
    competitionManagerName: "Rahul Khanna",
    groomName: "Ramesh Lal",
    farrierName: "Hari Pal",
    accountantName: "Sanjay Verma",
    parentName: "Arvind Sharma",
    horses: [
      { name: "Bijli", breed: "Marwari", sex: "M", ageYears: 9, heightHh: 15.1, ownership: "club", stableNo: "A1" },
      { name: "Champa", breed: "Indian Half-Bred", sex: "F", ageYears: 12, heightHh: 14.3, ownership: "club", stableNo: "A2" },
      { name: "Raja", breed: "Sindhi", sex: "M", ageYears: 7, heightHh: 15.0, ownership: "private", stableNo: "B1" },
    ],
    riders: [
      { firstName: "Aarav", lastName: "Sharma", dob: new Date("2014-06-12"), mobile: "9111100001", gender: "male", school: "DPS Ghaziabad", fatherPhone: "9111100002" },
      { firstName: "Aisha", lastName: "Sharma", dob: new Date("2012-09-23"), mobile: "9111100003", gender: "female", school: "DPS Ghaziabad", fatherPhone: "9111100002" },
    ],
  },
  {
    slug: "gurgaon",
    name: "Equiwings Gurgaon",
    address: "Sector 56, Gurgaon, Haryana",
    managerName: "Aman Chopra",
    headCoachName: "Capt. Rajesh Bhalla",
    coachName: "Lt. Tarun Malik",
    vetName: "Dr. Sunil Verma",
    examinerName: "Mrs. Reena Bhalla",
    stableManagerName: "Mohan Lal",
    inventoryManagerName: "Priya Anand",
    competitionManagerName: "Vivek Tiwari",
    groomName: "Raju Singh",
    farrierName: "Bhola Ram",
    accountantName: "Kavita Mathur",
    parentName: "Deepak Chopra",
    horses: [
      { name: "Tara", breed: "Kathiawari", sex: "F", ageYears: 8, heightHh: 14.2, ownership: "club", stableNo: "G1" },
      { name: "Surya", breed: "Marwari", sex: "M", ageYears: 10, heightHh: 15.2, ownership: "club", stableNo: "G2" },
      { name: "Moti", breed: "Thoroughbred", sex: "M", ageYears: 6, heightHh: 16.0, ownership: "private", stableNo: "G3" },
    ],
    riders: [
      { firstName: "Vihaan", lastName: "Chopra", dob: new Date("2013-03-04"), mobile: "9222200001", gender: "male", school: "Pathways World, Gurgaon", fatherPhone: "9222200002" },
      { firstName: "Myra", lastName: "Anand", dob: new Date("2015-11-08"), mobile: "9222200003", gender: "female", school: "Shri Ram, Aravali", fatherPhone: "9222200004" },
    ],
  },
  {
    slug: "mumbai",
    name: "Equiwings Mumbai",
    address: "Mahalaxmi Race Course Rd, Mumbai, Maharashtra",
    managerName: "Pranav Shah",
    headCoachName: "Capt. Naveen Iyer",
    coachName: "Maj. Karan Joshi",
    vetName: "Dr. Aditi Rao",
    examinerName: "Mrs. Sneha Iyer",
    stableManagerName: "Ganesh Bhosale",
    inventoryManagerName: "Anita Pillai",
    competitionManagerName: "Rohit Desai",
    groomName: "Vishnu Naik",
    farrierName: "Kishore Pawar",
    accountantName: "Manish Patil",
    parentName: "Nikhil Shah",
    horses: [
      { name: "Aakash", breed: "Anglo-Arabian", sex: "M", ageYears: 11, heightHh: 15.3, ownership: "club", stableNo: "M1" },
      { name: "Ruhi", breed: "Marwari", sex: "F", ageYears: 7, heightHh: 14.3, ownership: "club", stableNo: "M2" },
      { name: "Veer", breed: "Thoroughbred", sex: "M", ageYears: 5, heightHh: 16.1, ownership: "private", stableNo: "M3" },
    ],
    riders: [
      { firstName: "Ishaan", lastName: "Shah", dob: new Date("2013-07-15"), mobile: "9333300001", gender: "male", school: "Cathedral & John Connon", fatherPhone: "9333300002" },
      { firstName: "Diya", lastName: "Patel", dob: new Date("2014-12-02"), mobile: "9333300003", gender: "female", school: "Bombay Scottish, Mahim", fatherPhone: "9333300004" },
    ],
  },
  {
    slug: "bangalore",
    name: "Equiwings Bangalore",
    address: "Embassy Riding School Rd, Bangalore, Karnataka",
    managerName: "Karthik Reddy",
    headCoachName: "Capt. Anand Rao",
    coachName: "Lt. Suresh Nair",
    vetName: "Dr. Lalitha Murthy",
    examinerName: "Mrs. Geetha Rao",
    stableManagerName: "Manjunath Gowda",
    inventoryManagerName: "Latha Krishnan",
    competitionManagerName: "Vinay Kamath",
    groomName: "Basava Naik",
    farrierName: "Mahadev Patil",
    accountantName: "Shobha Iyer",
    parentName: "Suresh Reddy",
    horses: [
      { name: "Chetak", breed: "Marwari", sex: "M", ageYears: 10, heightHh: 15.0, ownership: "club", stableNo: "B1" },
      { name: "Lakshmi", breed: "Indian Half-Bred", sex: "F", ageYears: 9, heightHh: 14.2, ownership: "club", stableNo: "B2" },
      { name: "Arjun", breed: "Thoroughbred", sex: "M", ageYears: 8, heightHh: 16.2, ownership: "private", stableNo: "B3" },
    ],
    riders: [
      { firstName: "Rohan", lastName: "Reddy", dob: new Date("2012-04-19"), mobile: "9444400001", gender: "male", school: "Inventure Academy, Whitefield", fatherPhone: "9444400002" },
      { firstName: "Saanvi", lastName: "Nair", dob: new Date("2015-08-30"), mobile: "9444400003", gender: "female", school: "Greenwood High, Sarjapur", fatherPhone: "9444400004" },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// email pattern: `<role>.<slug>@equiwings.in`
function emailFor(roleKey: string, slug: string): string {
  return `${roleKey}.${slug}@equiwings.in`;
}

async function seedClub(spec: ClubSpec, orgId: string, pwd: string) {
  // 1. Centre
  const centre = await prisma.centre.upsert({
    where: { slug: spec.slug },
    create: {
      id: `centre_${spec.slug}`,
      orgId,
      slug: spec.slug,
      name: spec.name,
      address: spec.address,
    },
    update: { name: spec.name, address: spec.address },
  });

  // 2. Staff stakeholders — 11 roles per PRD §3, one user per role per club.
  type Stakeholder = { roleKey: string; role: string; name: string };
  const stakeholders: Stakeholder[] = [
    { roleKey: "manager",             role: "CENTRE_MANAGER",      name: spec.managerName },
    { roleKey: "headcoach",           role: "HEAD_COACH",          name: spec.headCoachName },
    { roleKey: "coach",               role: "COACH",               name: spec.coachName },
    { roleKey: "vet",                 role: "VET",                 name: spec.vetName },
    { roleKey: "examiner",            role: "EXAMINER",            name: spec.examinerName },
    { roleKey: "stablemanager",       role: "STABLE_MANAGER",      name: spec.stableManagerName },
    { roleKey: "inventorymanager",    role: "INVENTORY_MANAGER",   name: spec.inventoryManagerName },
    { roleKey: "groom",               role: "GROOM",               name: spec.groomName },
    { roleKey: "farrier",             role: "FARRIER",             name: spec.farrierName },
    { roleKey: "accountant",          role: "ACCOUNTANT",          name: spec.accountantName },
    // External / oversight logins the client (Ahmed) asked to see:
    // School Administrator (read-only club view) + Inspection Officer
    // (external auditor). All centre-scoped.
    { roleKey: "schooladmin",         role: "SCHOOL_ADMINISTRATOR", name: `${spec.name} School Admin` },
    { roleKey: "inspector",           role: "INSPECTION_OFFICER",   name: `${spec.name} Inspection Officer` },
  ];

  const userByKey: Record<string, { id: string }> = {};
  for (const s of stakeholders) {
    const user = await prisma.user.upsert({
      where: { email: emailFor(s.roleKey, spec.slug) },
      create: {
        email: emailFor(s.roleKey, spec.slug),
        name: s.name,
        role: s.role,
        centreId: centre.id,
        passwordHash: pwd,
      },
      update: {},
    });
    userByKey[s.roleKey] = user;
  }

  // 3. Wire the centre's primary manager.
  await prisma.centre.update({
    where: { id: centre.id },
    data: { managerId: userByKey.manager.id },
  });

  // 4. Parent — centreId stays null; tenancy flows through ParentLink.
  const parent = await prisma.user.upsert({
    where: { email: emailFor("parent", spec.slug) },
    create: {
      email: emailFor("parent", spec.slug),
      name: spec.parentName,
      role: "PARENT",
      centreId: null,
      passwordHash: pwd,
    },
    update: {},
  });

  // 5. Fee plans — one per canonical level.
  const FEE_PLAN_DEFAULTS: Record<string, { monthly: number; registration: number }> = {
    "Level 1": { monthly: 8000, registration: 3000 },
    "Level 2": { monthly: 10000, registration: 3000 },
    "Level 3": { monthly: 12000, registration: 3000 },
    "Level 4": { monthly: 14000, registration: 3000 },
  };
  for (const [levelName, amounts] of Object.entries(FEE_PLAN_DEFAULTS)) {
    await prisma.feePlan.upsert({
      where: { centreId_levelName: { centreId: centre.id, levelName } },
      create: { centreId: centre.id, levelName, monthlyAmount: amounts.monthly, registrationAmount: amounts.registration },
      update: {},
    });
  }

  // 6. Batches (Morning + Evening) — coach assignment uses the regular coach user.
  // Batch.level is left null — staff pick the appropriate level when riders
  // are placed in the batch.
  await prisma.batch.upsert({
    where: { id: `batch_${spec.slug}_morning` },
    create: {
      id: `batch_${spec.slug}_morning`,
      centreId: centre.id,
      name: "Morning · Mon-Wed-Fri",
      dayOfWeek: "Mon,Wed,Fri",
      startTime: "06:00",
      endTime: "07:00",
      coachId: userByKey.coach.id,
      level: null,
    },
    update: {},
  });
  await prisma.batch.upsert({
    where: { id: `batch_${spec.slug}_evening` },
    create: {
      id: `batch_${spec.slug}_evening`,
      centreId: centre.id,
      name: "Evening · Tue-Thu-Sat",
      dayOfWeek: "Tue,Thu,Sat",
      startTime: "17:00",
      endTime: "18:00",
      coachId: userByKey.coach.id,
      level: null,
    },
    update: {},
  });

  // 7. Progress levels + skill catalog — derived from the canonical rubric
  // file. Same logic as lib/centre-bootstrap so dev seed + production
  // bootstrap stay in lock-step.
  const levelKeys = ["1", "2", "3", "4"] as const;
  for (let i = 0; i < levelKeys.length; i++) {
    const key = levelKeys[i]!;
    const r = EQUIWINGS_RUBRICS[key];
    if (!r) continue;
    const level = await prisma.progressLevel.upsert({
      where: { centreId_name: { centreId: centre.id, name: r.levelName } },
      create: { centreId: centre.id, name: r.levelName, order: i + 1 },
      update: { order: i + 1 },
    });
    const skills = flattenRubricSkills(r.categories);
    for (const s of skills) {
      const existing = await prisma.skill.findFirst({
        where: { levelId: level.id, discipline: s.discipline, name: s.name },
        select: { id: true },
      });
      if (!existing) {
        await prisma.skill.create({ data: { levelId: level.id, discipline: s.discipline, name: s.name } });
      }
    }
  }

  // 8. Horses — skip if any already exist (idempotent re-seed).
  const horseCount = await prisma.horse.count({ where: { centreId: centre.id } });
  if (horseCount === 0) {
    await prisma.horse.createMany({
      data: spec.horses.map((h) => ({ centreId: centre.id, ...h })),
    });
  }

  // 9. Medicines — skip if any already exist.
  const medCount = await prisma.medicine.count({ where: { centreId: centre.id } });
  if (medCount === 0) {
    for (const m of STANDARD_MEDS) {
      await prisma.medicine.create({
        data: {
          centreId: centre.id,
          name: m.name,
          generic: m.generic,
          category: m.cat,
          batchNo: `B${Math.floor(Math.random() * 100000)}`,
          expDate: new Date(Date.now() + m.days * 86400000),
          qty: m.qty,
          reorderThreshold: 5,
          coldChain: m.cat === "vaccine",
        },
      });
    }
  }

  // 10. Scoring templates — all 4 canonical Equiwings levels from
  // equiwings-level-rubrics.json (single source of truth, shared with
  // ExamLevel.defaultRubricJson + centre-bootstrap). `update` populated so a
  // re-seed repairs clubs seeded with the old 2-level placeholder rubric.
  for (const levelKey of ["1", "2", "3", "4"] as const) {
    const r = EQUIWINGS_RUBRICS[levelKey];
    if (!r) continue;
    const data = {
      levelName: r.levelName,
      passThreshold: r.passThreshold,
      categoriesJson: JSON.stringify(r.categories),
    };
    await prisma.scoringTemplate.upsert({
      where: { centreId_levelKey: { centreId: centre.id, levelKey } },
      create: { centreId: centre.id, levelKey, ...data },
      update: data,
    });
  }

  // 11. Sample riders — skip if any already exist (idempotent).
  const riderCount = await prisma.rider.count({ where: { centreId: centre.id } });
  let firstRiderId: string | null = null;
  if (riderCount === 0) {
    for (const r of spec.riders) {
      const created = await prisma.rider.create({
        data: {
          centreId: centre.id,
          firstName: r.firstName,
          lastName: r.lastName,
          dob: r.dob,
          mobile: r.mobile,
          gender: r.gender,
          school: r.school ?? null,
          fatherPhone: r.fatherPhone ?? null,
          emergencyName: r.fatherPhone ? `Parent of ${r.firstName}` : null,
          emergencyPhone: r.fatherPhone ?? null,
          status: "active",
          registrationPaid: true,
        },
      });
      if (!firstRiderId) firstRiderId = created.id;
    }
  } else {
    const f = await prisma.rider.findFirst({ where: { centreId: centre.id }, select: { id: true } });
    firstRiderId = f?.id ?? null;
  }

  // 12. Link the parent to the first sample rider — gives the parent portal something to show.
  if (firstRiderId) {
    await prisma.parentLink.upsert({
      where: { parentUserId_riderId: { parentUserId: parent.id, riderId: firstRiderId } },
      create: { parentUserId: parent.id, riderId: firstRiderId, relationship: "father" },
      update: {},
    });

    // 13. Student/rider login — a RIDER-role user wired to the first rider so
    // the student portal (/student) has a working demo account. Ahmed asked
    // for a "Student Login" alongside the parent one.
    const studentEmail = emailFor("student", spec.slug);
    const studentUser = await prisma.user.upsert({
      where: { email: studentEmail },
      create: {
        email: studentEmail,
        name: `${spec.name} Student`,
        role: "RIDER",
        centreId: centre.id,
        passwordHash: pwd,
      },
      update: {},
    });
    await prisma.rider.update({ where: { id: firstRiderId }, data: { userId: studentUser.id } });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding…");

  const pwd = await bcrypt.hash("password", 10);

  // Platform owner — sits above all tenants. Used to access /owner/*.
  await prisma.platformUser.upsert({
    where: { email: "owner@platform.local" },
    create: {
      email: "owner@platform.local",
      name: "Platform Owner",
      role: "OWNER_ADMIN",
      passwordHash: pwd,
    },
    update: {},
  });

  // Equiwings tenant — first organisation. Enterprise plan, all features on.
  const org = await prisma.organisation.upsert({
    where: { id: "org_equiwings" },
    create: {
      id: "org_equiwings",
      slug: "equiwings",
      name: "Equiwings",
      plan: "enterprise",
      status: "active",
      contactName: "HQ Admin",
      billingEmail: "billing@equiwings.in",
    },
    update: { slug: "equiwings", name: "Equiwings", plan: "enterprise", status: "active" },
  });

  // Enable every feature for Equiwings (their plan = enterprise, fully on).
  for (const key of FEATURE_KEYS) {
    await prisma.orgFeature.upsert({
      where: { orgId_featureKey: { orgId: org.id, featureKey: key } },
      create: { orgId: org.id, featureKey: key, enabled: true },
      update: { enabled: true },
    });
  }

  // One super admin (HQ — sees and manages all clubs).
  await prisma.user.upsert({
    where: { email: "super@equiwings.in" },
    create: {
      email: "super@equiwings.in",
      name: "HQ Super Admin",
      role: "SUPER_ADMIN",
      centreId: null,
      orgId: org.id,
      passwordHash: pwd,
      phone: "+919999999999",
    },
    update: { orgId: org.id },
  });

  // HQ Admin — delegated peer of the super admin (cross-club write access,
  // no HQ-user management). Ahmed's hierarchy: Super Admin → Admin → clubs.
  await prisma.user.upsert({
    where: { email: "admin@equiwings.in" },
    create: {
      email: "admin@equiwings.in",
      name: "HQ Admin",
      role: "ADMIN",
      centreId: null,
      orgId: org.id,
      passwordHash: pwd,
    },
    update: { orgId: org.id },
  });

  // Each club gets its own full stakeholder set + sample data.
  for (const club of CLUBS) {
    await seedClub(club, org.id, pwd);
  }

  console.log("✓ Seed complete.");
  console.log("");
  console.log("Platform Owner (manages all tenants — /owner):");
  console.log("  owner@platform.local  /  password");
  console.log("");
  console.log("HQ:");
  console.log("  Super Admin:  super@equiwings.in  /  password   (sees all 4 clubs)");
  console.log("");
  for (const c of CLUBS) {
    console.log(`Club · ${c.name}  (/onboarding?centre=${c.slug})`);
    console.log(`  manager.${c.slug}@equiwings.in              ${c.managerName}`);
    console.log(`  headcoach.${c.slug}@equiwings.in            ${c.headCoachName}`);
    console.log(`  coach.${c.slug}@equiwings.in                ${c.coachName}`);
    console.log(`  vet.${c.slug}@equiwings.in                  ${c.vetName}`);
    console.log(`  examiner.${c.slug}@equiwings.in             ${c.examinerName}`);
    console.log(`  stablemanager.${c.slug}@equiwings.in        ${c.stableManagerName}`);
    console.log(`  inventorymanager.${c.slug}@equiwings.in     ${c.inventoryManagerName}`);
    console.log(`  groom.${c.slug}@equiwings.in                ${c.groomName}`);
    console.log(`  farrier.${c.slug}@equiwings.in              ${c.farrierName}`);
    console.log(`  accountant.${c.slug}@equiwings.in           ${c.accountantName}`);
    console.log(`  parent.${c.slug}@equiwings.in               ${c.parentName} (parent portal)`);
    console.log("");
  }
  console.log("All passwords: 'password' (rotate from /account before going live)");

  // ──────────────────────────────────────────────────────────────────────
  // Exam level catalog (HQ-curated, discipline-organised)
  // ──────────────────────────────────────────────────────────────────────
  // General + dressage + jumping + eventing + gymkhana progressions. Codes
  // and names follow common Indian/BHS conventions. Existing rows are
  // skipped via upsert so re-seeding doesn't duplicate.
  // General-discipline levels follow the Equiwings 4-level structure from
  // the reference module. The full rubric ships as defaultRubricJson so
  // every centre inherits the canonical scoring scheme.
  // defaultRubricJson is a jsonb column — pass the category array directly.
  // `undefined` skips the column (leaves DB default NULL) for levels without
  // a canonical rubric yet.
  const generalRubric: Record<string, Prisma.InputJsonValue | undefined> = {
    "1": EQUIWINGS_RUBRICS["1"] ? (EQUIWINGS_RUBRICS["1"].categories as Prisma.InputJsonValue) : undefined,
    "2": EQUIWINGS_RUBRICS["2"] ? (EQUIWINGS_RUBRICS["2"].categories as Prisma.InputJsonValue) : undefined,
    "3": EQUIWINGS_RUBRICS["3"] ? (EQUIWINGS_RUBRICS["3"].categories as Prisma.InputJsonValue) : undefined,
    "4": EQUIWINGS_RUBRICS["4"] ? (EQUIWINGS_RUBRICS["4"].categories as Prisma.InputJsonValue) : undefined,
  };
  const examLevels = [
    // General — 5 canonical Equiwings levels. Level 5 (Expert) added Oct
    // 2026 per client request — no rubric template yet, admins add one
    // via /exams/templates as the first Level-5 candidate emerges.
    { discipline: "general", orderIndex: 1, code: "1", name: "Level 1", passThreshold: 70, defaultRubricJson: generalRubric["1"] },
    { discipline: "general", orderIndex: 2, code: "2", name: "Level 2", passThreshold: 70, defaultRubricJson: generalRubric["2"] },
    { discipline: "general", orderIndex: 3, code: "3", name: "Level 3", passThreshold: 70, defaultRubricJson: generalRubric["3"] },
    { discipline: "general", orderIndex: 4, code: "4", name: "Level 4", passThreshold: 70, defaultRubricJson: generalRubric["4"] },
    // Dressage
    { discipline: "dressage", orderIndex: 1, code: "Prelim", name: "Preliminary", passThreshold: 60 },
    { discipline: "dressage", orderIndex: 2, code: "Novice", name: "Novice", passThreshold: 62 },
    { discipline: "dressage", orderIndex: 3, code: "Elem", name: "Elementary", passThreshold: 64 },
    { discipline: "dressage", orderIndex: 4, code: "Medium", name: "Medium", passThreshold: 65 },
    { discipline: "dressage", orderIndex: 5, code: "Adv-M", name: "Advanced Medium", passThreshold: 65 },
    { discipline: "dressage", orderIndex: 6, code: "Adv", name: "Advanced", passThreshold: 65 },
    // Show jumping
    { discipline: "jumping", orderIndex: 1, code: "60cm", name: "60 cm", passThreshold: 60 },
    { discipline: "jumping", orderIndex: 2, code: "80cm", name: "80 cm", passThreshold: 60 },
    { discipline: "jumping", orderIndex: 3, code: "1.00m", name: "1.00 m", passThreshold: 60 },
    { discipline: "jumping", orderIndex: 4, code: "1.10m", name: "1.10 m", passThreshold: 60 },
    { discipline: "jumping", orderIndex: 5, code: "1.20m", name: "1.20 m", passThreshold: 60 },
    // Eventing
    { discipline: "eventing", orderIndex: 1, code: "BE80", name: "BE80 (T)", passThreshold: 60 },
    { discipline: "eventing", orderIndex: 2, code: "BE90", name: "BE90", passThreshold: 60 },
    { discipline: "eventing", orderIndex: 3, code: "BE100", name: "BE100", passThreshold: 60 },
    // Gymkhana
    { discipline: "gymkhana", orderIndex: 1, code: "G1", name: "Lead-line games", passThreshold: 50 },
    { discipline: "gymkhana", orderIndex: 2, code: "G2", name: "Walk-trot games", passThreshold: 55 },
    { discipline: "gymkhana", orderIndex: 3, code: "G3", name: "Canter games", passThreshold: 60 },
  ];
  for (const lvl of examLevels) {
    await prisma.examLevel.upsert({
      where: { discipline_orderIndex: { discipline: lvl.discipline, orderIndex: lvl.orderIndex } },
      create: lvl,
      update: { code: lvl.code, name: lvl.name, passThreshold: lvl.passThreshold, active: true },
    });
  }
  console.log(`Exam levels: ${examLevels.length} catalog rows`);

  // ──────────────────────────────────────────────────────────────────────
  // Equipment catalog — the club's master tack/equipment list. Single source
  // of truth in prisma/equipment-catalog.ts (shared with the
  // replace_equipment_catalog data migration that applies it to existing DBs).
  const equipment = EQUIPMENT_CATALOG;
  for (const item of equipment) {
    await prisma.equipmentCatalog.upsert({
      where: { code: item.code },
      create: item,
      update: {
        name: item.name,
        category: item.category,
        unit: item.unit,
        defaultThreshold: item.defaultThreshold,
        notes: item.notes ?? null,
        active: true,
      },
    });
  }
  console.log(`Equipment catalog: ${equipment.length} items`);

  // ──────────────────────────────────────────────────────────────────────
  // Expense category catalog (HQ chart of accounts)
  // ──────────────────────────────────────────────────────────────────────
  const expenseCategories = [
    { code: "salary_coach", name: "Coach salaries", group: "salaries" },
    { code: "salary_groom", name: "Groom salaries", group: "salaries" },
    { code: "salary_admin", name: "Admin salaries", group: "salaries" },
    { code: "feed_hay", name: "Hay & forage", group: "feed" },
    { code: "feed_grain", name: "Grain & concentrate", group: "feed" },
    { code: "feed_supplements", name: "Supplements", group: "feed" },
    { code: "vet_consult", name: "Vet consultations", group: "vet" },
    { code: "vet_medicine", name: "Veterinary medicines", group: "vet" },
    { code: "vet_farrier", name: "Farrier visits", group: "vet" },
    { code: "vet_dental", name: "Dental care", group: "vet" },
    { code: "maintenance_arena", name: "Arena maintenance", group: "maintenance" },
    { code: "maintenance_stables", name: "Stable maintenance", group: "maintenance" },
    { code: "maintenance_tack", name: "Tack repairs", group: "maintenance" },
    { code: "maintenance_vehicle", name: "Vehicle maintenance", group: "maintenance" },
    { code: "utility_electricity", name: "Electricity", group: "utilities" },
    { code: "utility_water", name: "Water", group: "utilities" },
    { code: "utility_internet", name: "Internet & telephony", group: "utilities" },
    { code: "operating_rent", name: "Rent / lease", group: "operating" },
    { code: "operating_insurance", name: "Insurance premiums", group: "operating" },
    { code: "operating_fuel", name: "Fuel", group: "operating" },
    { code: "operating_office", name: "Office supplies", group: "operating" },
    { code: "operating_software", name: "Software subscriptions", group: "operating" },
    { code: "tax_gst", name: "GST liability", group: "tax" },
    { code: "tax_other", name: "Other taxes", group: "tax" },
    { code: "other_misc", name: "Miscellaneous", group: "other" },
  ];
  for (const c of expenseCategories) {
    await prisma.expenseCategory.upsert({
      where: { code: c.code },
      create: c,
      update: { name: c.name, group: c.group, active: true },
    });
  }
  console.log(`Expense categories: ${expenseCategories.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
