import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

// Resource route. All Liquid rendering and server imports live in the
// .server module so the client build does not pull them in.
// https://reactrouter.com/explanation/code-splitting#removal-of-server-code

export const loader = async (args: LoaderFunctionArgs) => {
  const { handleProxyLoader } = await import("../services/proxy-returns-route.server");
  return handleProxyLoader(args);
};

export const action = async (args: ActionFunctionArgs) => {
  const { handleProxyAction } = await import("../services/proxy-returns-route.server");
  return handleProxyAction(args);
};
