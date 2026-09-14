import ClassicWorkCenter from "./ClassicWorkCenter";
import OutboundWorkCenter from "./OutboundWorkCenter";

/** Keep the previous entry screen available while validating the new workflow. */
export default function WmsWorkCenterPage({ searchParams }: { searchParams: { view?: string } }) {
  return searchParams.view === "classic" ? <ClassicWorkCenter /> : <OutboundWorkCenter />;
}
