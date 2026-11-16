// Every text the person or the model reads, in English (the default) and French.

export type Lang = 'fr' | 'en'

/** The `language` option, English unless it says French. */
export const langOf = (value: unknown): Lang => (value === 'fr' ? 'fr' : 'en')

const s = (n: number) => (n > 1 ? 's' : '')

const fr = {
  paneTitle: 'Revue',
  commandDescription: 'Revue claire des changements de la branche',
  commandHint: '[lien de PR]',
  noReview: 'Pas encore de changement à expliquer dans cette conversation.',
  noChange: 'Aucun changement à expliquer.',
  status: { idle: 'à jour', running: '⟳ mise à jour…', stale: 'en retard', failed: 'échec', waiting: 'en attente' },
  failed: (reason: string) => `échec : ${reason}`,
  failure: {
    invalidReply: 'réponse du modèle illisible',
    model: "le modèle n'a pas répondu",
    git: 'commande git en échec',
    truncated: 'diff trop gros pour être lu',
    github: 'GitHub ne répond pas (gh)',
  },
  header: (files: number) => `Revue · ${files} fichier${s(files)}`,
  summaryLabel: 'En bref',
  intentionsLabel: 'Intentions',
  inferred: 'déduite',
  importance: { key: 'clé', normal: '', minor: 'mineur' },
  added: 'nouveau',
  deleted: 'supprimé',
  renamed: 'renommé',
  skipped: (n: number) => `${n} non expliqué${s(n)}`,
  filesInPage: (n: number) => `${n} fichier${s(n)} · voir dans la revue`,
  gone: 'Dossier supprimé : revue figée.',
  updating: { title: '⟳ Mise à jour de la revue…', hint: "La revue revient dès que c'est fini." },
  opening: '⟳ Ouverture de la revue…',
  button: {
    showCode: 'Voir le code ▸',
    hideCode: 'Masquer le code ▾',
    retry: 'Réessayer',
    refresh: 'Actualiser',
    openReview: 'Ouvrir la revue',
    openArtifact: "Voir l'artefact ↗",
  },
  page: {
    error: {
      python: 'Page de revue indisponible : python3 introuvable sur ce Mac.',
      start: "Page de revue indisponible : son serveur n'a pas démarré.",
      stopped: "Page de revue indisponible : son serveur s'est arrêté.",
    },
    publishFailed: (reason: string) => `Publication impossible (${reason})`,
    publishReason: { refused: 'refusée', denied: 'annulée', failed: 'erreur' },
    publishDescription: (name: string, branch: string) => `Revue des changements de ${name} sur la branche ${branch}`,
    publishConsent: "J'ai appuyé sur Publier dans la page de revue",
  },
  askHere: ({ path, from, to, explanation }: { path: string; from: number; to: number; explanation: string }) =>
    `Dans \`${path}\` lignes ${from}-${to} (${explanation}), que se passe-t-il exactement ? Explique le déroulé, ce qui appelle ce code et ce qu'il appelle.`,
  askSelection: ({ path, from, to }: { path: string; from: number; to: number }) =>
    `Que fait le code de \`${path}\` lignes ${from}-${to} ? Explique son rôle, ce qui l'appelle et ce qu'il appelle.`,
  answer: {
    waiting: 'en attente',
    running: '⟳ réponse en cours…',
    added: 'ajoutée à ta demande',
    moved: 'le code a changé depuis',
    error: { interrupted: 'interrompue', failed: 'échec' },
    retry: 'Réessayer',
    heading: 'Réponses',
    count: (n: number) => `${n} question${s(n)} en cours`,
    refused: { inFlight: 'Cette question est déjà en cours.', full: 'Trop de questions en cours : attends une réponse.', unknownFile: "Ce fichier n'est pas dans la revue." },
  },
  askFree: ({ root, files, question }: { root: string; files: string[]; question: string }) =>
    `À propos des changements de la branche dans \`${root}\` (fichiers : ${files.join(', ')}) : ${question}`,
  prs: {
    heading: 'PR de cette conversation',
    viewedHeading: 'PR regardées',
    open: 'Ouvrir',
    state: { open: 'ouverte', merged: 'fusionnée', closed: 'fermée' },
    toReview: 'à revoir',
    unreachable: 'inaccessible',
  },
  modelLanguage: 'French',
}

export type Texts = typeof fr

const en: Texts = {
  paneTitle: 'Review',
  commandDescription: "Clear review of the branch's changes",
  commandHint: '[PR link]',
  noReview: 'No change to explain in this conversation yet.',
  noChange: 'No change to explain.',
  status: { idle: 'up to date', running: '⟳ updating…', stale: 'behind', failed: 'failed', waiting: 'waiting' },
  failed: (reason: string) => `failed: ${reason}`,
  failure: {
    invalidReply: 'unreadable model reply',
    model: 'the model did not answer',
    git: 'a git command failed',
    truncated: 'diff too big to read',
    github: 'GitHub did not answer (gh)',
  },
  header: (files: number) => `Review · ${files} file${s(files)}`,
  summaryLabel: 'In short',
  intentionsLabel: 'Intentions',
  inferred: 'inferred',
  importance: { key: 'key', normal: '', minor: 'minor' },
  added: 'new',
  deleted: 'deleted',
  renamed: 'renamed',
  skipped: (n: number) => `${n} not explained`,
  filesInPage: (n: number) => `${n} file${s(n)} · see them in the review`,
  gone: 'Folder deleted: review frozen.',
  updating: { title: '⟳ Updating the review…', hint: "The review comes back once it's done." },
  opening: '⟳ Opening the review…',
  button: {
    showCode: 'Show code ▸',
    hideCode: 'Hide code ▾',
    retry: 'Retry',
    refresh: 'Refresh',
    openReview: 'Open the review',
    openArtifact: 'View the artifact ↗',
  },
  page: {
    error: {
      python: 'Review page unavailable: python3 not found on this Mac.',
      start: 'Review page unavailable: its server did not start.',
      stopped: 'Review page unavailable: its server stopped.',
    },
    publishFailed: (reason: string) => `Could not publish (${reason})`,
    publishReason: { refused: 'refused', denied: 'cancelled', failed: 'error' },
    publishDescription: (name: string, branch: string) => `Review of the changes in ${name} on branch ${branch}`,
    publishConsent: 'I pressed Publish on the review page',
  },
  askHere: ({ path, from, to, explanation }: { path: string; from: number; to: number; explanation: string }) =>
    `In \`${path}\` lines ${from}-${to} (${explanation}), what exactly is happening here? Explain the flow, what calls this code and what it calls.`,
  askSelection: ({ path, from, to }: { path: string; from: number; to: number }) =>
    `What does the code of \`${path}\` lines ${from}-${to} do? Explain its role, what calls it and what it calls.`,
  answer: {
    waiting: 'waiting',
    running: '⟳ answering…',
    added: 'added to your request',
    moved: 'the code has changed since',
    error: { interrupted: 'interrupted', failed: 'failed' },
    retry: 'Retry',
    heading: 'Answers',
    count: (n: number) => `${n} question${s(n)} under way`,
    refused: { inFlight: 'This question is already under way.', full: 'Too many questions under way: wait for an answer.', unknownFile: 'This file is not in the review.' },
  },
  askFree: ({ root, files, question }: { root: string; files: string[]; question: string }) =>
    `About the branch's changes in \`${root}\` (files: ${files.join(', ')}): ${question}`,
  prs: {
    heading: "This conversation's PRs",
    viewedHeading: 'Viewed PRs',
    open: 'Open',
    state: { open: 'open', merged: 'merged', closed: 'closed' },
    toReview: 'to review',
    unreachable: 'unreachable',
  },
  modelLanguage: 'English',
}

export const texts = (lang: Lang): Texts => (lang === 'en' ? en : fr)
