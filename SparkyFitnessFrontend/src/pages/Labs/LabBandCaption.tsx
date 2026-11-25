import { useTranslation } from 'react-i18next';

/**
 * The "Shaded band = optimal target. Grey band = lab reference." caption,
 * naming only the parts drawn. `showReference` is whether any shown chart has
 * a reference band.
 */
const LabBandCaption = ({ showReference }: { showReference: boolean }) => {
  const { t } = useTranslation();
  const optimal = t('labs.trends.bandOptimal', 'Shaded band = optimal target.');
  return (
    <p className="text-xs text-muted-foreground" data-testid="lab-band-caption">
      {showReference
        ? t(
            'labs.trends.bandCaption',
            'Shaded band = optimal target. Grey band = lab reference.'
          )
        : optimal}
    </p>
  );
};

export default LabBandCaption;
