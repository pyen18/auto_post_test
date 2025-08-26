export default function AlarmList({ alarms }: { alarms: string[] }) {
  return (
    <div className="mt-3">
      <div className="text-sm font-semibold mb-1">Alarms đã tạo:</div>
      <ul className="text-xs list-disc pl-5 space-y-1">
        {alarms.length === 0 && <li>(trống)</li>}
        {alarms.map((a, idx) => (
          <li key={idx}>{a}</li>
        ))}
      </ul>
    </div>
  );
}
