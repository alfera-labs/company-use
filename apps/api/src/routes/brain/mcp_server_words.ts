export const mcp_server_instructions =
  "Alfera is this company's AI coworker. It already holds what you cannot see from here: the " +
  "company's connected apps (CRM, inbox, store, spreadsheets, calendar), and standing jobs that " +
  'run with nobody asking. When the person asks what Alfera is or can do, do not describe it: ' +
  'call list_integrations and list_automations and show what this workspace really has. Quick ' +
  'facts answer at once: list_integrations, list_automations, list_skills. Work in the apps, ' +
  'live data, or anything with several steps: create_session with the task, then ' +
  'wait_for_session, then send_message to carry on in the same session. If wait_for_session ' +
  'returns waiting_for_approval, show the held action to the person and answer with ' +
  'confirm_tool only after they say yes or no. list_session_files says what a session ' +
  'produced. Report what the coworker actually did, and never state a result while a session ' +
  'is still running.';

export const list_agents_description =
  'List the coworkers in this workspace. Each has a slug you can pass to create_session; `main` is the default and is right unless the person names another.';

export const create_session_description =
  "Hand real work to the Alfera coworker: anything that must read or change the company's connected apps (CRM, inbox, spreadsheets, store, calendar), build a file, or take several steps. Pass the task as message, in the person's own words plus any detail they gave. The coworker works on its own for 30 seconds to a few minutes; call wait_for_session with the returned session_id and report only what it actually said. For a quick fact use list_integrations, list_automations or list_skills instead: they answer at once.";
