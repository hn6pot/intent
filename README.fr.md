# intent

Un mod Claude Code (API des mods en accès anticipé, qui peut changer). Version anglaise : [README.md](README.md).

Une « revue » explique ce qu'apporte la branche courante, avec les intentions tirées de la conversation (pourquoi chaque changement a été fait, pas seulement ce qui a changé). Elle se lit sur une **page de revue** à deux onglets, **Histoire** (les intentions, chacune avec ses fichiers et ses hunks) et **Fichiers** (le diff complet, fichier par fichier). Le panneau latéral en est la télécommande, gardée compacte : le choix dossier · branche en haut (seulement quand la conversation travaille dans plusieurs dossiers), la ligne d'état avec le bouton **Ouvrir la revue** (ouvre la page dans le navigateur par défaut), le résumé court, les intentions, le nombre de fichiers (ils sont sur la page), et pour les réponses seulement combien sont en cours et la première ligne de la dernière arrivée. Pendant que la revue du dossier affiché se met à jour, le panneau n'affiche que « Mise à jour de la revue… », sans rien à appuyer, jusqu'à la fin. Quand la page est tombée (après un rechargement du mod, ou quand son serveur s'est arrêté ou n'a pas démarré), **Ouvrir la revue** la relance, affiche « Ouverture de la revue… » en attendant, et l'ouvre une fois prête (10 s au plus, sinon le panneau dit qu'elle n'a pas démarré). La revue est régénérée à la fin d'un tour de la boucle principale, seulement si le diff a changé et que le panneau ou la page est ouvert ; une revue en échec est retentée à la fin du tour suivant, même sans changement. `/intent` rouvre le panneau et rattrape les revues laissées de côté pendant qu'il était fermé.

## Les questions vont directement au modèle

Trois façons de creuser, toutes sur la page (le panneau ne pose aucune question) :

- **« Que se passe-t-il ici ? »** sur un hunk de la page ;
- **une question libre** tapée sur la page ;
- **un morceau de code sélectionné** sur la page, puis **« Expliquer cette partie »**.

Aucune ne touche à la conversation : le mod envoie lui-même chaque question au modèle (`sonnet`, effort moyen, un appel de 2 000 tokens et 2 minutes au plus), comme un agent sans outils. Aucun agent ne démarre, donc aucune permission à donner et rien à juger pour le mode auto ; rien n'est ajouté à la conversation, et le tour principal n'est pas interrompu.

Ce que reçoit le modèle, et rien d'autre : la question ; les lignes qu'elle vise ; le résumé de la revue et l'intention du changement ; et le fichier de la question tel qu'il est maintenant, lu par le mod, autour de ces lignes (600 lignes et 40 000 caractères au plus, numérotés). Une question libre reçoit le résumé de la revue, ses intentions et les fichiers revus avec leur rôle. La réponse **ne voit que ça** : elle ne peut ni ouvrir d'autres fichiers du dépôt ni rien lancer, et le dit quand ce qu'elle a reçu ne suffit pas. Un fichier illisible est laissé de côté ; la question part quand même.

Au plus **3 questions sont traitées à la fois** ; les autres attendent leur tour, dans l'ordre où elles ont été posées. Un appel qui ne rapporte pas de réponse (erreur d'API, réponse vide, appel coupé) échoue avec sa raison, et **Réessayer** le renvoie. La fin de la conversation coupe les appels encore en cours ; une question en cours au moment où le mod se recharge ou la conversation reprend apparaît comme interrompue.

La réponse s'affiche **sous le code qu'elle concerne**, sur la page seulement (le panneau montre combien sont en cours et la première ligne de la dernière), marquée « ajoutée à ta demande ». Une réponse en échec dit pourquoi, avec un bouton **Réessayer** quand la page peut la renvoyer (pas pour des lignes sélectionnées qui ont bougé depuis). Les réponses sont gardées avec la revue : 50 au plus par revue (au-delà, la plus ancienne terminée part ; jamais une en attente ou en cours) et 4 000 caractères chacune. **Publier** ne garde que les réponses terminées, sans le chemin absolu du dépôt ni le dossier personnel (`~`), ni dans elles ni dans les explications.

Un appui = un envoi : après un appui, le bouton est verrouillé et affiche « Envoyé », et la même question ne peut pas repartir tant qu'une autre n'a pas été envoyée.

**Coût :** un appel au modèle par question, avec le fichier autour.

Quels dossiers : les dossiers de travail git où la conversation écrit (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`, sous-agents compris). Un dossier seulement lu (`cd` ou `git -C` dans une commande Bash, ou le dossier de départ de la conversation) reste caché, sans revue, jusqu'à ce que son diff change, qu'un fichier y soit écrit, ou que `/intent` soit lancé (qui le revoit aussitôt).

## Les PR de cette conversation

La colonne **Sources** de la page (et, en plus court, le panneau) liste, par dépôt, la revue de la branche courante et deux groupes de pull requests :

- **Les PR de cette conversation** : les PR ouvertes ici (`gh pr create` dans la conversation), et la PR de la branche d'un dossier où Claude a travaillé (trouvée avec `gh pr view` dans ce dossier). Une PR arrivée là ne retourne jamais dans l'autre groupe.
- **Les PR regardées** : toute autre PR dont le lien GitHub apparaît dans tes messages ou dans la sortie d'une commande lancée par Claude (un lien collé pour explorer, un `gh pr list`). Les liens dans ce qu'écrit Claude, ou dans les fichiers et pages qu'il lit, sont ignorés. Elle passe dans le premier groupe dès que Claude écrit dans sa branche.

Un clic sur une PR la revoit, avec les mêmes onglets, questions, sélection et **Publier** qu'une revue de branche. La PR de la branche courante ouvre la revue de cette branche (même diff), avec le numéro et le lien de la PR en haut.

**`/intent <lien de PR>`** ouvre aussitôt la page sur la revue de cette PR, comme un clic : la PR rejoint les PRs vues si la conversation ne la connaissait pas. Un autre mod peut faire de même en lançant la commande ; c'est ainsi que le bouton **Relire avec intent** du mod [lighthouse](https://github.com/hn6pot/lighthouse) transmet les PRs qu'on te demande de relire.

**D'où vient le diff :** du clone local (un dossier suivi par la conversation avec le même `origin`) : le mod récupère les commits qui lui manquent, puis fait le diff depuis la merge-base de la tête de la PR et de son commit de base. Si le dépôt n'est pas cloné ou que la récupération échoue, `gh pr diff` le fournit, avec 3 lignes de contexte seulement (la page le dit). **Rien n'est écrit sur GitHub** : seuls `gh pr view` et `gh pr diff` tournent (avec le compte gh du propriétaire du dépôt quand la config de [lighthouse](https://github.com/hn6pot/lighthouse#ghconfigdirs-one-gh-account-per-owner) en associe un dans `ghConfigDirs`, sinon le compte actif), et `git fetch --no-tags origin` pour le clone.

**Intentions :** pour une PR ouverte dans cette conversation, elles viennent de la conversation, comme pour une branche. Pour toute autre PR, elles sont toujours **déduites** (de son titre, sa description et ses messages de commit, envoyés au modèle comme blocs de données balisés, jamais comme consignes) : le mod l'impose, il ne se contente pas de le demander au modèle.

**Gardée par commit :** une revue de PR est rangée sous `pr:<owner/repo>#<numéro>@<commit de tête>`, 50 au plus (les plus anciennes partent). Rouvrir une PR au même commit ne fait aucun appel au modèle. Après un push, la PR affiche **nouveau commit**, et **Mettre à jour** la revoit.

`gh` n'est interrogé que tant que le panneau n'a pas été fermé à la main ou que la page est ouverte (elle se signale toutes les 10 secondes), aussitôt pour une nouvelle PR puis au plus toutes les 5 minutes par PR. Une PR fusionnée ou fermée n'est plus interrogée d'elle-même ; un clic interroge toujours.

**Coût :** un appel au modèle par PR et par commit revu (et un par question, comme plus haut).

## La page de revue

Un petit serveur local (`server/serve.py`) sert la page à `http://127.0.0.1:<port>/?t=<jeton>`, à cette machine seulement. Le jeton est tiré au lancement : le serveur refuse toute requête sans lui, et toute question dont l'`Origin` n'est pas la page elle-même. La page n'a besoin d'aucun site externe. Rien ne quitte la machine tant que tu n'appuies pas sur **Publier**.

**Publier** écrit une copie autonome de la page (un seul fichier HTML, données comprises, sans le champ de question, sans les boutons de la page qui posent une question, et sans chemins locaux) et la publie comme artefact claude.ai privé, en appelant lui-même l'outil `Artifact`, avec la demande de permission habituelle. La copie est écrite dans le dossier de la conversation ; quand l'outil y refuse un fichier, elle est réécrite sous `<cwd>/.git/info/intent-publish-*.html` (seulement quand `.git` est un dossier, pas dans un worktree), et cette copie est supprimée à la fin de la conversation. Republier le même dépôt et la même branche met normalement à jour le même artefact (un nouveau si l'outil refuse la mise à jour). Le bouton est caché quand l'outil `Artifact` n'est pas disponible pour le compte.

Python est nécessaire pour la page : `/usr/bin/python3`, sinon `python3` du `PATH` (3.7 ou plus), bibliothèque standard seulement. Sans lui (ou quand le serveur ne démarre pas, ou s'arrête), le panneau le dit en une ligne et garde la vue détaillée de l'étape 1 (code replié), pour que la revue ne soit pas perdue ; aucune question ne peut être posée tant que la page ne tourne pas.

## Langue

Tout ce que le mod affiche ou envoie à Claude est en anglais par défaut, ou en français. L'option `language` (`en` ou `fr`) se règle dans le menu `/config` (la ligne `intent`), ou dans les réglages :

```json
{ "pluginConfigs": { "intent@intent": { "options": { "language": "fr" } } } }
```

(`intent` ou `intent@inline` pour un plugin chargé avec `--plugin-dir`.) La changer recharge le module.

## Ce qu'il garde

La revue générée d'une conversation vit dans le store du plugin (`$.store`), sous la clé `session:<id>`, pendant 30 jours, sans le code de ses hunks (une revue reprise le récupère depuis le diff à la fin du tour suivant). Quand le store est plein, la conversation la plus ancienne part. Les revues de PR sont gardées à part, une par PR et par commit de tête (`pr:<owner/repo>#<numéro>@<tête>`, 50 au plus).

Sur disque, la page a besoin de fichiers par conversation sous `~/.claude-mods/intent/<id de conversation>/` : la revue courante (`review.json`, avec ses diffs) et les copies autonomes écrites pour Publier. Les questions passent par la sortie standard du serveur, pas par un fichier. Le dossier est supprimé à la fin de la conversation ; les dossiers oubliés sont supprimés au bout de 30 jours. Rien n'est écrit sans interface.

## Ce qu'il ne fait pas

- **Pas de chasse aux bugs** : il explique un changement, il ne le juge pas (prends un outil de revue pour ça).
- **Rien de publié sur GitHub** : aucun commentaire, aucune description de PR ; une revue de PR ne fait que lire (`gh pr view`, `gh pr diff`, `git fetch`).
- **Sans interface** (`claude -p`) : le mod ne fait rien.
- **Rien d'écrit par les questions** : ce sont des appels au modèle sans outils ; elles ne modifient jamais un fichier et ne lancent rien.

## Installer

```bash
claude plugin marketplace add hn6pot/intent
claude plugin install intent@intent
```

Puis `/reload-plugins` dans une conversation ouverte.

## Tester

```bash
claude plugin test . && claude plugin validate .
```

Le serveur de la page :

```bash
/usr/bin/python3 -m unittest discover -s tests/server
```
