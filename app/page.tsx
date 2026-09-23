import { CalendarDays } from "lucide-react";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "./chatgpt-auth";
import BookingCalendar from "./booking-calendar-loader";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getChatGPTUser();
  // Show a sign-in screen instead of redirecting straight to sign-in; otherwise signing out could
  // bounce straight back into an active sign-in session.
  if (!user) return <SignedOut justSignedOut={(await searchParams).signed_out === "1"} />;
  return (
    <BookingCalendar
      displayName={user.fullName ?? user.displayName}
      email={user.email}
      signOutPath={chatGPTSignOutPath("/?signed_out=1")}
    />
  );
}

function SignedOut({ justSignedOut }: { justSignedOut: boolean }) {
  return (
    <main className="signin-screen">
      <section className="signin-card">
        <span className="signin-icon"><CalendarDays /></span>
        <p className="eyebrow">Roomie</p>
        <h1>{justSignedOut ? "You've signed out" : "Sign in to Roomie"}</h1>
        <p>{justSignedOut ? "Sign back in any time to see your listings and bookings." : "Your listings, calendars and bookings are private to your account."}</p>
        <a className="signin-button" href={chatGPTSignInPath("/")} target="_top">Sign in</a>
      </section>
    </main>
  );
}
