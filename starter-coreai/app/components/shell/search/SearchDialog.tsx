// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';
import { useState } from 'react';
import { Dismiss24Regular, SearchRegular } from '@fluentui/react-icons';
import { Button, Dialog, DialogSurface, Input } from '@coreai-ds/react-components';

import styles from './SearchDialog.module.css';

interface SearchDialogProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function SearchDialog({
  isOpen: controlledIsOpen,
  onClose: controlledOnClose,
}: SearchDialogProps): JSX.Element {
  const [internalIsOpen, setInternalIsOpen] = useState(false);

  // Use controlled state if provided, otherwise use internal state
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const handleClose = controlledOnClose || (() => setInternalIsOpen(false));

  return (
    <Dialog open={isOpen} onOpenChange={(_, data) => !data.open && handleClose()}>
      <DialogSurface className={styles.surface}>
        <Input
          autoFocus
          size="large"
          className={styles.searchBar}
          placeholder="Search"
          contentBefore={<SearchRegular aria-hidden={true} />}
          appearance="filled-lighter"
          contentAfter={
            <Button
              appearance="subtle"
              icon={<Dismiss24Regular />}
              onClick={handleClose}
              aria-label="Close search"
              className={styles.closeButton}
              shape="rounded"
            />
          }
        />
      </DialogSurface>
    </Dialog>
  );
}
