import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();
async function mk(tag: string, pwd: string) {
  const org = await prisma.organisation.create({ data: { slug: `o-${tag}`, name: `Org${tag}` } });
  const centre = await prisma.centre.create({ data: { orgId: org.id, name: `Centre${tag}`, slug: `c-${tag}` } });
  await prisma.user.create({ data: { role: "SUPER_ADMIN", name: `Admin${tag}`, email: `a-${tag}@x.test`, passwordHash: pwd, orgId: org.id, status: "active" } });
  await prisma.rider.create({ data: { centreId: centre.id, firstName: "Zrider", lastName: tag.toUpperCase(), dob: new Date("2010-01-01"), mobile: "9", status: "active" } });
  await prisma.horse.create({ data: { centreId: centre.id, name: `Zhorse-${tag}`, status: "active" } });
  await prisma.user.create({ data: { role: "COACH", name: `Zstaff-${tag}`, email: `st-${tag}@x.test`, passwordHash: pwd, orgId: org.id, centreId: centre.id, status: "active" } });
}
(async () => { const pwd = await bcrypt.hash("password", 10); await mk("aaa", pwd); await mk("bbb", pwd); })()
  .catch(e=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect());
