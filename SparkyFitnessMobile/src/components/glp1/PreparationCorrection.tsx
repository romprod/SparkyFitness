import { useState, useRef } from 'react';
import { Text, View, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  medicationPreparationReviewInputSchema,
  type MedicationPen,
  type MedicationPreparationReviewInput,
  type MedicationPreparationReview,
} from '@workspace/shared';
import {
  usePreparationCorrection,
  usePreparationReview,
} from '../../hooks/usePreparationCorrection';
import { ApiError } from '../../services/api/errors';
import { newUuid } from '../../utils/ids';
import Button from '../ui/Button';
import PreparationFields, {
  preparationDraft,
  preparationCorrectionValues,
} from './PreparationFields';

export default function PreparationCorrection({
  pen,
  onClose,
  bud,
}: {
  pen: MedicationPen;
  onClose: () => void;
  bud?: MedicationPreparationReviewInput['bud'];
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => preparationDraft(pen.preparation));
  const [stage, setStage] = useState<'mode' | 'amounts' | 'review'>('mode');
  const [reviewed, setReviewed] = useState<{
    input: MedicationPreparationReviewInput;
    review: MedicationPreparationReview;
  } | null>(null);
  const review = usePreparationReview(pen.id);
  const correction = usePreparationCorrection(pen.id);
  const operation = useRef(newUuid());
  const inFlight = useRef(false);
  if (review.scopeValid === false || correction.scopeValid === false)
    return (
      <View className="gap-3">
        <Text className="text-sm text-text-muted">
          {t('medications.preparation.accountChanged', {
            defaultValue:
              'The active account changed. Reopen this preparation.',
          })}
        </Text>
        <Button variant="secondary" onPress={onClose}>
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </Button>
      </View>
    );
  const candidate = {
    expected_revision: pen.preparation?.revision ?? 0,
    preparation: preparationCorrectionValues(draft),
    ...(bud ? { bud } : {}),
  };
  const parsedCandidate =
    medicationPreparationReviewInputSchema.safeParse(candidate);
  const currentReview =
    reviewed &&
    parsedCandidate.success &&
    JSON.stringify({
      preparation: reviewed.input.preparation,
      bud: reviewed.input.bud,
    }) ===
      JSON.stringify({
        preparation: parsedCandidate.data.preparation,
        bud: parsedCandidate.data.bud,
      })
      ? reviewed
      : null;
  const fail = () => {
    operation.current = newUuid();
    setReviewed(null);
    setStage('amounts');
    Alert.alert(
      t('common.error', { defaultValue: 'Error' }),
      t('medications.preparation.reviewAgain', {
        defaultValue:
          'The preparation changed or could not be saved. Review it again.',
      })
    );
  };
  const inspect = () => {
    const parsed = parsedCandidate;
    if (!parsed.success) {
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('medications.preparation.invalidRecord', {
          defaultValue:
            'Enter positive vial content, a positive final volume and a prepared date.',
        })
      );
      return;
    }
    operation.current = newUuid();
    review.mutate(parsed.data, {
      onSuccess: (result) => {
        setReviewed({ input: parsed.data, review: result });
        setStage('review');
      },
      onError: fail,
    });
  };
  return (
    <View className="gap-3 rounded-xl border border-chrome-border p-3">
      <Text className="text-base font-semibold text-text-primary">
        {t('medications.preparation.edit', {
          defaultValue: 'Edit preparation',
        })}
      </Text>
      {stage !== 'review' ? (
        <PreparationFields
          draft={draft}
          stage={stage}
          onChange={(next) => {
            setDraft(next);
            setReviewed(null);
          }}
        />
      ) : (
        currentReview && (
          <>
            <Text className="text-sm text-text-secondary">
              {t('medications.preparation.changeSummary', {
                defaultValue: 'Concentration: {{before}} → {{after}} mg/mL',
                before: currentReview.review.before.concentration_mg_ml,
                after: currentReview.review.after.concentration_mg_ml,
              })}
            </Text>
            <Text className="text-sm text-text-secondary">
              {t('medications.preparation.balanceSummary', {
                defaultValue: 'Remaining: {{mass}} mg / {{volume}} mL',
                mass: currentReview.review.after.remaining_mg ?? '—',
                volume: currentReview.review.after.remaining_ml ?? '—',
              })}
            </Text>
            <Text className="text-sm text-text-secondary">
              {t('medications.preparation.affected', {
                defaultValue: 'Affected recorded doses: {{count}}',
                count: currentReview.review.affected_dose_count,
              })}
            </Text>
            {currentReview.review.overdraw_warning && (
              <Text className="text-sm text-text-warning">
                {t('medications.preparation.overdrawn', {
                  defaultValue: 'Logged use exceeds the recorded vial content.',
                })}
              </Text>
            )}
            {!currentReview.review.can_confirm && (
              <Text className="text-sm text-text-warning">
                {t('medications.preparation.incompleteHistory', {
                  defaultValue:
                    'Preparation cannot be corrected because the physical dose history is incomplete.',
                })}
              </Text>
            )}
            <Button
              disabled={
                !currentReview.review.can_confirm || correction.isPending
              }
              loading={correction.isPending}
              onPress={() => {
                if (inFlight.current) return;
                inFlight.current = true;
                correction.mutate(
                  {
                    ...currentReview.input,
                    review_hash: currentReview.review.review_hash,
                    operation_id: operation.current,
                  },
                  {
                    onSuccess: onClose,
                    onError: (error) => {
                      if (error instanceof ApiError && error.statusCode === 409)
                        fail();
                      else
                        Alert.alert(
                          t('common.error', { defaultValue: 'Error' }),
                          t('medications.preparation.retryCorrection', {
                            defaultValue:
                              'The correction could not be confirmed. Retry to check the same operation, or go back to review again.',
                          })
                        );
                    },
                    onSettled: () => {
                      inFlight.current = false;
                    },
                  }
                );
              }}
            >
              {t('medications.preparation.confirmCorrection', {
                defaultValue: 'Confirm preparation correction',
              })}
            </Button>
          </>
        )
      )}
      {stage === 'mode' && (
        <Button variant="secondary" onPress={() => setStage('amounts')}>
          {t('common.next', { defaultValue: 'Next' })}
        </Button>
      )}
      {(stage === 'amounts' || (stage === 'review' && !currentReview)) && (
        <Button
          variant="secondary"
          loading={review.isPending}
          onPress={inspect}
        >
          {t('medications.preparation.review', {
            defaultValue: 'Review preparation',
          })}
        </Button>
      )}
      {stage !== 'mode' && (
        <Button
          variant="secondary"
          disabled={correction.isPending}
          onPress={() => {
            setReviewed(null);
            setStage(stage === 'review' ? 'amounts' : 'mode');
          }}
        >
          {t('common.back', { defaultValue: 'Back' })}
        </Button>
      )}
      <Button
        variant="secondary"
        disabled={correction.isPending}
        onPress={onClose}
      >
        {t('common.cancel', { defaultValue: 'Cancel' })}
      </Button>
    </View>
  );
}
