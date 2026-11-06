import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return redirect(`/proxy/withdraw?${url.searchParams.toString()}`);
};

export default function WithdrawConfirmRedirect() {
  return null;
}