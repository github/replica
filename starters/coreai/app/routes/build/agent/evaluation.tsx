import type { JSX } from 'react';

import { Text } from '@coreai-ds/react-components';
import { PageBody } from '~/components/common';

import styles from './placeholder.module.css';

export default function AgentEvaluation(): JSX.Element {
  return (
    <PageBody scrollable>
      <div className={styles.placeholder}>
        <div className={styles.placeholderContent}>
          <Text foreground={1} preset="heading2">
            Evaluation
          </Text>
          <Text preset="body" foreground={2} className={styles.placeholderDescription}>
            Evaluate agent performance and quality here
          </Text>
        </div>
      </div>
    </PageBody>
  );
}
