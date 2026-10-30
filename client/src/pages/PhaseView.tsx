import PhaseWorkflow from '../components/PhaseWorkflow';

interface Props {
  phaseId: string;
  sessionId: string;
  projectName?: string;
  onBack: () => void;
  onProceed?: (nextPhaseId: string, nextSessionId: string) => void;
  onSelectPhase?: (phaseId: string) => void;
}

/**
 * The generic phase screen — architecture today, design/testing/release once their
 * configs are filled in. The requirement phase keeps its own intake screen
 * (Home.tsx), which handles uploads and the ticket entry point.
 */
export default function PhaseView(props: Props) {
  return <PhaseWorkflow {...props} />;
}
