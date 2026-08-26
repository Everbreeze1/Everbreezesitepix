import { Activity, FolderKanban, Images, User } from "@/ui/icons";
import Tabs from "expo-router/js-tabs";
import { TabBar } from "@/components/TabBar";
import { Icon } from "@/ui";

/**
 * The four top-level surfaces, plus the camera the custom bar draws between
 * them.
 *
 * Which four is a judgement about the field, not a mirror of the web sidebar.
 * Web has thirteen sidebar entries because it is where the office works;
 * everything to do with authoring (templates, blueprints, the report builder,
 * the portfolio) belongs there and is deliberately absent here. What is left is
 * the set someone standing on a site opens: the jobs, the pictures, what the
 * crew did, and their own account.
 *
 * `headerShown` is off because the parent stack draws the header. Two
 * navigators both rendering one would stack two title bars on every tab.
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Projects",
          tabBarIcon: ({ color }) => <Icon icon={FolderKanban} size="lg" color={color} />,
        }}
      />
      <Tabs.Screen
        name="gallery"
        options={{
          title: "Gallery",
          tabBarIcon: ({ color }) => <Icon icon={Images} size="lg" color={color} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: "Activity",
          tabBarIcon: ({ color }) => <Icon icon={Activity} size="lg" color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color }) => <Icon icon={User} size="lg" color={color} />,
        }}
      />
    </Tabs>
  );
}
