import { COUNTIES, isCountyId, type CountyId } from "@/lib/board/counties";

/** The county in the header. Looking at another county saves nothing. */
export function CountySwitch({
  county,
  onChange,
}: {
  county: CountyId;
  onChange: (county: CountyId) => void;
}) {
  return (
    <label className="mast-county">
      <span className="sr-only">County</span>
      <select
        value={county}
        onChange={(event) => {
          if (isCountyId(event.target.value)) onChange(event.target.value);
        }}
      >
        {COUNTIES.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
}
