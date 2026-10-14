export type OnboardingJobThatNeedsNoApp = {
  name: string;
  offer: string;
  steps: string[];
  title: string;
  body: string;
  prompt: string;
  first_question: string;
};

export const onboarding_jobs_that_need_no_app: OnboardingJobThatNeedsNoApp[] = [
  {
    name: 'A task on a schedule',
    offer:
      "I'll run a task you describe every weekday at 9:00 and save the result in your workspace folder.",
    steps: [
      'You tell me the task once, in plain words',
      'Every weekday at 9:00 I run it on my own',
      'I save the result as a file you can open',
    ],
    title: 'A task that runs on a schedule',
    body: 'You describe a task once. I run it every weekday at 9:00 and save the result as a file.',
    prompt:
      'Create a scheduled task for every weekday at 9:00 that does the task they describe and saves its result as a file in the workspace folder.',
    first_question: 'What should I do every weekday at 9:00?',
  },
  {
    name: 'A page built from one sentence',
    offer:
      "I'll build a one-page site or a small tool from one sentence you give me, and you open it in Files.",
    steps: [
      'You describe the page or the tool in one sentence',
      'I build it as one file, with no app and no account',
      'You open it in Files and tell me what to change',
    ],
    title: 'A page built from one sentence',
    body: 'You give me one sentence. I build a one-page site or a small tool as one file, and you open it in Files.',
    prompt:
      'Build what they describe as one HTML file that holds its own styles and scripts and loads nothing from the internet. Save it as files/<short-name>.html in the workspace folder. Then tell them the file name, and that it opens in the Files panel.',
    first_question:
      'What should I build first: a page for something you do, or a small tool such as a tip calculator?',
  },
  {
    name: 'A weekly report from your files',
    offer:
      "I'll write a one-page report every Friday at 16:00 from the files in your workspace folder.",
    steps: [
      'Every Friday at 16:00 I read the files in your workspace folder',
      'I write what changed this week on one page',
      'I save the report as a new file in the same folder',
    ],
    title: 'A weekly report from your files',
    body: 'Every Friday at 16:00 I read the files in your workspace folder and save a one-page report of what changed.',
    prompt:
      'Create a scheduled task for every Friday at 16:00: read the files they name in the workspace folder, write a one-page report of what changed this week, and save it as a new file in the same folder. When the folder holds no file yet, create the task all the same and tell them the first report covers what is there on Friday.',
    first_question: 'Which files should the Friday report cover: all of them, or one folder?',
  },
];

export function find_onboarding_job_that_needs_no_app(name: string | undefined) {
  return onboarding_jobs_that_need_no_app.find((job) => job.name === name) ?? null;
}
