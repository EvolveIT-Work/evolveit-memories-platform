import OrderMenu from "../../OrderMenu";

export default function CounterOrderPage({ params }: { params: { stationCode: string } }) {
  return <OrderMenu context="counter" token={params.stationCode} />;
}
