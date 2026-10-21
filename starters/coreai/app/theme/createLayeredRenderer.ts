// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createDOMRenderer, type GriffelRenderer } from '@griffel/react';

type CSSRulesByBucket = Parameters<GriffelRenderer['insertCSSRules']>[0];

export function createLayeredRenderer(targetDocument?: Document): GriffelRenderer {
  const renderer = createDOMRenderer(targetDocument);
  const insertCSSRules = renderer.insertCSSRules.bind(renderer);

  renderer.insertCSSRules = (rules) => {
    const layeredRules: CSSRulesByBucket = {};

    for (const bucket of Object.keys(rules) as (keyof CSSRulesByBucket)[]) {
      layeredRules[bucket] = rules[bucket]?.map((entry) => {
        // Tuple metadata controls Griffel's media/container stylesheet ordering.
        if (typeof entry === 'string') {
          return `@layer griffel{${entry}}`;
        }
        return [`@layer griffel{${entry[0]}}`, entry[1]];
      });
    }

    insertCSSRules(layeredRules);
  };

  return renderer;
}
