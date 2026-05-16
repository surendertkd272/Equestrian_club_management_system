import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { FEATURE_KEYS } from "../lib/features";

const prisma = new PrismaClient();

// Canonical Equiwings rubric for general Levels 1–4 (sourced from the
// `equiwings_equistrien_exam_moduel` reference module). Pre-fills
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

const SKILL_TREE: Record<string, Record<string, string[]>> = {
  normal: {
    Beginner: ["Mount & dismount", "Halt", "Walk on a circle", "Posting trot (straight)", "Aids for forward/halt"],
    Intermediate: ["Sitting trot (5 strides)", "Two-point at trot", "Walk-trot-walk transitions", "Canter on correct lead"],
    Advanced: ["Counter canter", "Half-halt", "Working canter on 20m circle", "Riding without stirrups"],
  },
  dressage: {
    Beginner: ["20m circle at walk", "Halt at X", "Straightness on long side"],
    Intermediate: ["20m circle at trot", "Free walk on long rein", "Leg yield at walk"],
    Advanced: ["Shoulder-in at trot", "Simple change", "Medium trot"],
  },
  jumping: {
    Beginner: ["Walk over poles", "Trot over single pole"],
    Intermediate: ["Cross-rail single", "3 trot poles + cross-rail", "Two-point over jump"],
    Advanced: ["60cm vertical course", "Related distance 5 strides", "Bending line"],
  },
  gymkhana: {
    Beginner: ["Lead-line walk obstacle"],
    Intermediate: ["Pole bending (walk)", "Barrel turn at trot"],
    Advanced: ["Pole bending (canter)", "Flag race at canter"],
  },
  tent_pegging: {
    Intermediate: ["Walk approach + lance carry"],
    Advanced: ["Trot tent peg pickup", "Canter tent peg pickup"],
  },
  endurance: {
    Intermediate: ["20-min trot circuit"],
    Advanced: ["60-min endurance ride with vet check"],
  },
};

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
    { roleKey: "competitionmanager",  role: "COMPETITION_MANAGER", name: spec.competitionManagerName },
    { roleKey: "groom",               role: "GROOM",               name: spec.groomName },
    { roleKey: "farrier",             role: "FARRIER",             name: spec.farrierName },
    { roleKey: "accountant",          role: "ACCOUNTANT",          name: spec.accountantName },
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

  // 5. Fee plans (Beginner + Intermediate).
  await prisma.feePlan.upsert({
    where: { centreId_levelName: { centreId: centre.id, levelName: "Beginner" } },
    create: { centreId: centre.id, levelName: "Beginner", monthlyAmount: 8000, registrationAmount: 3000 },
    update: {},
  });
  await prisma.feePlan.upsert({
    where: { centreId_levelName: { centreId: centre.id, levelName: "Intermediate" } },
    create: { centreId: centre.id, levelName: "Intermediate", monthlyAmount: 10000, registrationAmount: 3000 },
    update: {},
  });

  // 6. Batches (Morning + Evening) — coach assignment uses the regular coach user.
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
      level: "Beginner",
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
      level: "Intermediate",
    },
    update: {},
  });

  // 7. Progress levels + skill catalog.
  const beginnerLevel = await prisma.progressLevel.upsert({
    where: { centreId_name: { centreId: centre.id, name: "Beginner" } },
    create: { centreId: centre.id, name: "Beginner", order: 1 },
    update: {},
  });
  const intermediateLevel = await prisma.progressLevel.upsert({
    where: { centreId_name: { centreId: centre.id, name: "Intermediate" } },
    create: { centreId: centre.id, name: "Intermediate", order: 2 },
    update: {},
  });
  const advancedLevel = await prisma.progressLevel.upsert({
    where: { centreId_name: { centreId: centre.id, name: "Advanced" } },
    create: { centreId: centre.id, name: "Advanced", order: 3 },
    update: {},
  });
  const levelByName: Record<string, { id: string }> = {
    Beginner: beginnerLevel,
    Intermediate: intermediateLevel,
    Advanced: advancedLevel,
  };
  for (const [discipline, byLevel] of Object.entries(SKILL_TREE)) {
    for (const [levelName, names] of Object.entries(byLevel)) {
      const level = levelByName[levelName];
      if (!level) continue;
      const existing = await prisma.skill.findFirst({
        where: { levelId: level.id, discipline },
        select: { id: true },
      });
      if (existing) continue;
      for (const name of names) {
        await prisma.skill.create({ data: { levelId: level.id, discipline, name } });
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

  // 10. Scoring templates (Level 1, Level 2).
  await prisma.scoringTemplate.upsert({
    where: { centreId_levelKey: { centreId: centre.id, levelKey: "1" } },
    create: {
      centreId: centre.id,
      levelKey: "1",
      levelName: "Level 1 — Beginner",
      passThreshold: 60,
      categoriesJson: JSON.stringify(LEVEL_1_RUBRIC),
    },
    update: {},
  });
  await prisma.scoringTemplate.upsert({
    where: { centreId_levelKey: { centreId: centre.id, levelKey: "2" } },
    create: {
      centreId: centre.id,
      levelKey: "2",
      levelName: "Level 2 — Intermediate",
      passThreshold: 65,
      categoriesJson: JSON.stringify(LEVEL_2_RUBRIC),
    },
    update: {},
  });

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
    console.log(`  competitionmanager.${c.slug}@equiwings.in   ${c.competitionManagerName}`);
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
  const generalRubric: Record<string, string | null> = {
    "1": EQUIWINGS_RUBRICS["1"] ? JSON.stringify(EQUIWINGS_RUBRICS["1"].categories) : null,
    "2": EQUIWINGS_RUBRICS["2"] ? JSON.stringify(EQUIWINGS_RUBRICS["2"].categories) : null,
    "3": EQUIWINGS_RUBRICS["3"] ? JSON.stringify(EQUIWINGS_RUBRICS["3"].categories) : null,
    "4": EQUIWINGS_RUBRICS["4"] ? JSON.stringify(EQUIWINGS_RUBRICS["4"].categories) : null,
  };
  const examLevels = [
    // General — 4 canonical Equiwings levels
    { discipline: "general", orderIndex: 1, code: "1", name: "Beginner", passThreshold: 70, defaultRubricJson: generalRubric["1"] },
    { discipline: "general", orderIndex: 2, code: "2", name: "Elementary", passThreshold: 70, defaultRubricJson: generalRubric["2"] },
    { discipline: "general", orderIndex: 3, code: "3", name: "Intermediate", passThreshold: 70, defaultRubricJson: generalRubric["3"] },
    { discipline: "general", orderIndex: 4, code: "4", name: "Advanced", passThreshold: 70, defaultRubricJson: generalRubric["4"] },
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
  // Equipment catalog (HQ-curated, ~70 standard items)
  // ──────────────────────────────────────────────────────────────────────
  // Reorder defaults are conservative for a mid-size club. Each centre can
  // raise/lower per-row from the inventory page.
  const equipment: { category: string; code: string; name: string; unit: string; defaultThreshold: number }[] = [
    // Saddlery
    { category: "saddlery", code: "saddle_dressage", name: "Dressage saddle", unit: "piece", defaultThreshold: 3 },
    { category: "saddlery", code: "saddle_jumping", name: "Jumping saddle", unit: "piece", defaultThreshold: 3 },
    { category: "saddlery", code: "saddle_general", name: "General-purpose saddle", unit: "piece", defaultThreshold: 5 },
    { category: "saddlery", code: "saddle_pad", name: "Saddle pad", unit: "piece", defaultThreshold: 10 },
    { category: "saddlery", code: "girth", name: "Girth", unit: "piece", defaultThreshold: 8 },
    { category: "saddlery", code: "stirrup_leathers", name: "Stirrup leathers", unit: "pair", defaultThreshold: 8 },
    { category: "saddlery", code: "stirrup_irons", name: "Stirrup irons", unit: "pair", defaultThreshold: 8 },
    { category: "saddlery", code: "breastplate", name: "Breastplate", unit: "piece", defaultThreshold: 3 },
    { category: "saddlery", code: "crupper", name: "Crupper", unit: "piece", defaultThreshold: 2 },
    // Bridlery
    { category: "bridlery", code: "bridle_snaffle", name: "Snaffle bridle", unit: "piece", defaultThreshold: 8 },
    { category: "bridlery", code: "bridle_double", name: "Double bridle", unit: "piece", defaultThreshold: 2 },
    { category: "bridlery", code: "bit_snaffle", name: "Snaffle bit", unit: "piece", defaultThreshold: 8 },
    { category: "bridlery", code: "bit_pelham", name: "Pelham bit", unit: "piece", defaultThreshold: 3 },
    { category: "bridlery", code: "reins_plain", name: "Plain reins", unit: "pair", defaultThreshold: 6 },
    { category: "bridlery", code: "halter", name: "Headcollar / halter", unit: "piece", defaultThreshold: 12 },
    { category: "bridlery", code: "lead_rope", name: "Lead rope", unit: "piece", defaultThreshold: 12 },
    { category: "bridlery", code: "lunge_cavesson", name: "Lunge cavesson", unit: "piece", defaultThreshold: 3 },
    // Protection
    { category: "protection", code: "boots_brushing", name: "Brushing boots", unit: "pair", defaultThreshold: 8 },
    { category: "protection", code: "boots_tendon", name: "Tendon boots", unit: "pair", defaultThreshold: 6 },
    { category: "protection", code: "boots_over_reach", name: "Over-reach boots", unit: "pair", defaultThreshold: 6 },
    { category: "protection", code: "boots_bell", name: "Bell boots", unit: "pair", defaultThreshold: 4 },
    { category: "protection", code: "bandages_stable", name: "Stable bandages", unit: "set", defaultThreshold: 8 },
    { category: "protection", code: "bandages_polo", name: "Polo wraps", unit: "set", defaultThreshold: 6 },
    // Rider gear
    { category: "rider", code: "helmet", name: "Riding helmet", unit: "piece", defaultThreshold: 10 },
    { category: "rider", code: "body_protector", name: "Body protector", unit: "piece", defaultThreshold: 6 },
    { category: "rider", code: "gloves", name: "Riding gloves", unit: "pair", defaultThreshold: 12 },
    { category: "rider", code: "whip", name: "Whip / crop", unit: "piece", defaultThreshold: 6 },
    { category: "rider", code: "spurs", name: "Spurs", unit: "pair", defaultThreshold: 4 },
    { category: "rider", code: "riding_boots", name: "Riding boots (loaner)", unit: "pair", defaultThreshold: 6 },
    // Stable
    { category: "stable", code: "mucking_fork", name: "Mucking fork", unit: "piece", defaultThreshold: 4 },
    { category: "stable", code: "wheelbarrow", name: "Wheelbarrow", unit: "piece", defaultThreshold: 3 },
    { category: "stable", code: "broom", name: "Yard broom", unit: "piece", defaultThreshold: 4 },
    { category: "stable", code: "bucket", name: "Water bucket", unit: "piece", defaultThreshold: 12 },
    { category: "stable", code: "feed_scoop", name: "Feed scoop", unit: "piece", defaultThreshold: 4 },
    { category: "stable", code: "haynet", name: "Hay net", unit: "piece", defaultThreshold: 12 },
    { category: "stable", code: "rubber_mat", name: "Stable rubber mat", unit: "piece", defaultThreshold: 6 },
    { category: "stable", code: "rug_summer", name: "Summer sheet / rug", unit: "piece", defaultThreshold: 6 },
    { category: "stable", code: "rug_winter", name: "Winter rug", unit: "piece", defaultThreshold: 6 },
    // Grooming
    { category: "grooming", code: "curry_comb", name: "Curry comb", unit: "piece", defaultThreshold: 8 },
    { category: "grooming", code: "dandy_brush", name: "Dandy brush", unit: "piece", defaultThreshold: 8 },
    { category: "grooming", code: "body_brush", name: "Body brush", unit: "piece", defaultThreshold: 8 },
    { category: "grooming", code: "face_brush", name: "Face brush", unit: "piece", defaultThreshold: 6 },
    { category: "grooming", code: "hoof_pick", name: "Hoof pick", unit: "piece", defaultThreshold: 10 },
    { category: "grooming", code: "sweat_scraper", name: "Sweat scraper", unit: "piece", defaultThreshold: 4 },
    { category: "grooming", code: "mane_comb", name: "Mane / tail comb", unit: "piece", defaultThreshold: 4 },
    { category: "grooming", code: "shampoo", name: "Horse shampoo", unit: "litre", defaultThreshold: 5 },
    // Feed
    { category: "feed", code: "feed_bin", name: "Feed bin (50kg)", unit: "piece", defaultThreshold: 4 },
    { category: "feed", code: "salt_lick", name: "Salt lick block", unit: "piece", defaultThreshold: 6 },
    { category: "feed", code: "hay_kg", name: "Hay (kg in stock)", unit: "kg", defaultThreshold: 200 },
    { category: "feed", code: "grain_kg", name: "Grain feed (kg in stock)", unit: "kg", defaultThreshold: 100 },
    // Tack room
    { category: "tackroom", code: "saddle_rack", name: "Saddle rack", unit: "piece", defaultThreshold: 8 },
    { category: "tackroom", code: "bridle_hook", name: "Bridle hook", unit: "piece", defaultThreshold: 12 },
    { category: "tackroom", code: "saddle_soap", name: "Saddle soap", unit: "piece", defaultThreshold: 4 },
    { category: "tackroom", code: "leather_oil", name: "Leather oil", unit: "litre", defaultThreshold: 3 },
    { category: "tackroom", code: "cleaning_sponge", name: "Cleaning sponge", unit: "piece", defaultThreshold: 12 },
    // Arena / training
    { category: "arena", code: "jump_pole", name: "Jump pole (3m)", unit: "piece", defaultThreshold: 20 },
    { category: "arena", code: "jump_wing", name: "Jump wing", unit: "pair", defaultThreshold: 6 },
    { category: "arena", code: "jump_cup", name: "Jump cup", unit: "piece", defaultThreshold: 24 },
    { category: "arena", code: "trot_pole", name: "Trot pole", unit: "piece", defaultThreshold: 12 },
    { category: "arena", code: "cone", name: "Training cone", unit: "piece", defaultThreshold: 20 },
    { category: "arena", code: "lunge_line", name: "Lunge line", unit: "piece", defaultThreshold: 4 },
    { category: "arena", code: "lunge_whip", name: "Lunge whip", unit: "piece", defaultThreshold: 3 },
    { category: "arena", code: "side_reins", name: "Side reins", unit: "pair", defaultThreshold: 3 },
    { category: "arena", code: "dressage_letters", name: "Dressage arena letters (set)", unit: "set", defaultThreshold: 1 },
    // Vet / first aid
    { category: "vet", code: "first_aid_kit", name: "First-aid kit", unit: "piece", defaultThreshold: 2 },
    { category: "vet", code: "thermometer", name: "Thermometer (rectal, equine)", unit: "piece", defaultThreshold: 2 },
    { category: "vet", code: "stethoscope", name: "Stethoscope", unit: "piece", defaultThreshold: 1 },
    { category: "vet", code: "bandage_scissors", name: "Bandage scissors", unit: "piece", defaultThreshold: 2 },
    { category: "vet", code: "wound_dressing", name: "Wound dressing pads", unit: "piece", defaultThreshold: 20 },
    { category: "vet", code: "antiseptic", name: "Antiseptic solution", unit: "litre", defaultThreshold: 3 },
  ];
  for (const item of equipment) {
    await prisma.equipmentCatalog.upsert({
      where: { code: item.code },
      create: item,
      update: {
        name: item.name,
        category: item.category,
        unit: item.unit,
        defaultThreshold: item.defaultThreshold,
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
