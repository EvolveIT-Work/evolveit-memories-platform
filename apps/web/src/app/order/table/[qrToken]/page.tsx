import OrderMenu from "../../OrderMenu";

export default function TableOrderPage({ params }: { params: { qrToken: string } }) {
  return <OrderMenu context="table" token={params.qrToken} />;
}
