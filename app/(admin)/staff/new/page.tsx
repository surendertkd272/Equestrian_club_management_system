import { NewStaffForm } from "./form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function NewStaffPage() {
  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Add Staff</CardTitle>
          <CardDescription>
            Creates a user account (login enabled) and a staff record (employment metadata). Default password is{" "}
            <code>password123</code> — the user should change it on first login.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewStaffForm />
        </CardContent>
      </Card>
    </div>
  );
}
