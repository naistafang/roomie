import { chatGPTSignOutPath, requireChatGPTUser } from "./chatgpt-auth";
import BookingCalendar from "./booking-calendar";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  return (
    <BookingCalendar
      displayName={user.fullName ?? user.displayName}
      email={user.email}
      signOutPath={chatGPTSignOutPath("/")}
    />
  );
}
