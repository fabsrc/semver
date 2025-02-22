import * as gitRawCommits from 'git-raw-commits';
import { EMPTY, Observable, throwError } from 'rxjs';
import { catchError, last, map, scan, startWith } from 'rxjs/operators';
import { exec } from '../../common/exec';
import { logStep, _logStep } from './logger';

/**
 * Return the list of commits since `since` commit.
 */
export function getCommits({
  projectRoot,
  since,
}: {
  projectRoot: string;
  since: string;
}): Observable<string[]> {
  return new Observable<string>((observer) => {
    gitRawCommits({
      from: since,
      path: projectRoot,
    })
      .on('data', (data: string) => observer.next(data))
      .on('error', (error: Error) => observer.error(error))
      .on('close', () => observer.complete())
      .on('finish', () => observer.complete());
  }).pipe(
    scan((commits, commit) => [...commits, commit.toString()], [] as string[]),
    startWith([]),
    last()
  );
}

export function tryPush({
  remote,
  branch,
  noVerify,
  projectName,
  tag,
}: {
  tag: string;
  remote: string;
  branch: string;
  noVerify: boolean;
  projectName: string;
}): Observable<string> {
  if (remote == null || branch == null) {
    return throwError(
      () =>
        new Error(
          'Missing option --remote or --branch, see: https://github.com/jscutlery/semver#configure.'
        )
    );
  }

  const gitPushOptions = [...(noVerify ? ['--no-verify'] : [])];

  return exec('git', [
    'push',
    ...gitPushOptions,
    '--atomic',
    remote,
    branch,
    tag,
  ])
    .pipe(
      catchError((error) => {
        if (/atomic/.test(error)) {
          _logStep({
            step: 'warning',
            level: 'warn',
            message: 'Git push --atomic failed, attempting non-atomic push.',
            projectName,
          });
          return exec('git', ['push', ...gitPushOptions, remote, branch, tag]);
        }

        return throwError(() => error);
      })
    )
    .pipe(
      logStep({
        step: 'push_success',
        message: `Pushed to "${remote}" "${branch}".`,
        projectName,
      })
    );
}

export function addToStage({
  paths,
  dryRun,
}: {
  paths: string[];
  dryRun: boolean;
}): Observable<void> {
  if (paths.length === 0) {
    return EMPTY;
  }

  const gitAddOptions = [...(dryRun ? ['--dry-run'] : []), ...paths];
  return exec('git', ['add', ...gitAddOptions]).pipe(map(() => undefined));
}

export function getFirstCommitRef(): Observable<string> {
  return exec('git', ['rev-list', '--max-parents=0', 'HEAD']).pipe(
    map((output) => output.trim())
  );
}

export function createTag({
  dryRun,
  tag,
  commitMessage,
  projectName,
}: {
  dryRun: boolean;
  tag: string;
  commitMessage: string;
  projectName: string;
}): Observable<string> {
  if (dryRun) {
    return EMPTY;
  }

  return exec('git', ['tag', '-a', tag, '-m', commitMessage]).pipe(
    catchError((error) => {
      if (/already exists/.test(error)) {
        return throwError(
          () =>
            new Error(`Failed to tag "${tag}", this tag already exists.
            This error occurs because the same version was previously created but the tag does not point to a commit referenced in your base branch.
            Please delete the tag by running "git tag -d ${tag}", make sure the tag has been removed from the remote repository as well and run this command again.`)
        );
      }

      return throwError(() => error);
    }),
    map(() => tag),
    logStep({
      step: 'tag_success',
      message: `Tagged "${tag}".`,
      projectName,
    })
  );
}
